// Signing in to keep a guest map (the owner, 13 Nov 2026, e_n2ayhy6u): the one step of the guest's setup plan that waits
// on the person. Its owner, signed in to the map with the token its page was given (./guests.ts), types an address and
// the code mailed to it; the address becomes the map's owner's (./members.ts keepAt), the map is kept (keepGuest: its
// days and its limits go), the plan's sign-in step is ticked, and the server's pack that sells workspaces is told (its
// gate kept: packs/surface/kernel/server-gates.ts), which starts the trial, or, for an address or machine that had one,
// leaves the map read-only until a plan is chosen (the owner, 14 Nov 2026). The map is not copied: it is the same
// workspace, with the same items and the same look. An address already a member elsewhere keeps it as one more.
//
// POST /connect/keep, its body { email } to mail the code, then { email, code, agree?, machine? } to keep it; `machine`
// is the installer's id for the computer (~/.pelago/machine), carried by the agent's sign-in to the page that asks.

import { guestOf, keepGuest } from './guests.ts';
import { keepAt, keepCode, mailKeepCode, signedIn } from './members.ts';
import { bypassingRls } from './outbox.ts';
import type { Answered, SignInAt } from './sign-in.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';
import type { Op } from '../../write/kernel/pelago-types.ts';

/** What the server's pack that sells workspaces said of a kept map: a trial and its end, or the plan it waits for. */
export interface Kept {
  trial?: { ends: string };
  /** Where to choose a plan, when no trial is left to this address or machine: the map is read-only until then. */
  upgrade?: string;
}

export interface KeepAt extends SignInAt {
  /** Tell the server's pack that sells workspaces that one was kept (its gate kept); nothing where none does. */
  kept(ask: { workspace: string; email: string; machine?: string }): Promise<Kept>;
}

const answer = (status: number, body: unknown): Answered => ({ status, body });
const MACHINE = /^[a-f0-9]{32}$/;

/** The setup plan's step that waits on the person to sign in, ticked: its wait is over. Best effort: a plan drawn otherwise is left as it is. */
async function tickSignIn(whole: Archipelago, me: string): Promise<void> {
  const { rows } = await whole.db.query<{ id: string; from_id: string }>(`select id, from_id from relation where type = 'waits_on' and to_id = $1 and valid_to is null and props->>'for' = 'sign in' limit 20`, [me]);
  if (!rows.length) return;
  const ops = rows.flatMap((r): Op[] => [{ op: 'unlink', relation: r.id }, { op: 'update', id: r.from_id, status: 'done' }]);
  await whole.apply('system', { ops, reason: 'Signed in: the map is kept' }).catch((err: Error) => console.error(`guest map ${whole.workspace}: its sign-in step was not ticked: ${err.message}`));
}

export async function keepGuestMap(at: KeepAt): Promise<Answered> {
  const { ws, actor, look } = await at.person();
  const who = actor();
  const control = await at.workspaces.control();
  const guest = await guestOf(control, ws.id);
  if (!guest) return answer(404, { error: 'This is not a guest map: sign in as usual.' });
  const me = await ws.pelago.setting<string>('me');
  if (look || who.kind !== 'human' || !who.admin || !me || who.person !== me) return answer(403, { error: 'Only the guest map’s owner keeps it, in their browser.' });
  if (guest.saved) return answer(409, { error: 'This map is kept already.' });
  at.hold(ws.id);
  const body = ((await at.body()) ?? {}) as { email?: unknown; code?: unknown; agree?: unknown; machine?: unknown };
  const email = at.email(body.email);
  if (!email) return answer(400, { error: 'That is not an email address.' });
  const db = ws.pelago.db;
  if (body.code === undefined) {
    await mailKeepCode(db, ws.id, email);
    return answer(200, { sent_to: email });
  }
  const code = String(body.code);
  const spent = answer(429, { error: 'Too many wrong codes for this address. Wait half an hour, then ask for a new email.' });
  const looked = await keepCode(db, control, email, code, true);
  if (looked === 'tries') return spent;
  if (looked === 'ok') {
    const owed = await at.owes(email, body.agree);
    if (owed.length) return answer(200, { agree: owed });
  }
  const taken = await keepCode(db, control, email, code);
  if (taken !== 'ok') return taken === 'tries' ? spent : answer(410, { error: 'That code was not accepted: it may be mistyped, used or run out.' });
  const whole = await bypassingRls(ws.pelago);
  const member = await keepAt(whole, email);
  // Ticked while the map is still a guest's: what the pack says next may leave it read-only.
  await tickSignIn(whole, me);
  await keepGuest(control, ws.id);
  const machine = typeof body.machine === 'string' && MACHINE.test(body.machine) ? body.machine : undefined;
  let kept: Kept = {};
  try {
    kept = await at.kept({ workspace: ws.id, email, ...(machine && { machine }) });
  } catch (err) {
    // Kept all the same: the map is theirs, and the pack is asked again by whoever runs the server.
    console.error(`guest map ${ws.id}: kept, and the pack that sells workspaces did not answer: ${(err as Error).message}`);
  }
  return answer(200, { token: await signedIn(db, ws.id, member), workspace: { id: ws.id, name: ws.name }, ...kept });
}
