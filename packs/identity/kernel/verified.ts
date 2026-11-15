// An address proved by someone other than a code in the mail (Google or GitHub: ./social.ts; a passkey: ./passkeys.ts),
// waiting for the page to finish with it: a ticket, kept ten minutes, that the page trades once (POST /connect/verified).
// Kept apart from the proof so what comes after it is the same for every way in: what the address owes is asked first,
// a member of several workspaces picks one, and a guest map's owner keeps their map (the owner, 14 Nov 2026: sign up
// with Google, GitHub or a code, and a passkey for next time; e_9ewt9kc6).

import { newSecret, sha256Hex } from '../../../src/hashes.ts';
import { keep, kept, take } from '../../database/kernel/transient.ts';
import type { Q } from '../../database/kernel/db.ts';
import { keepVerified, type KeepAt } from './guest-keep.ts';
import { signInAs, type Answered } from './sign-in.ts';

/** What a ticket holds: the address proved, by what, and what it was for (keeping a guest map, or signing in). */
export interface Proved {
  email: string;
  via: string;
  for: 'keep' | 'sign-in';
  /** The guest map to keep, and the installer's id for the computer, for `keep`. */
  workspace?: string;
  machine?: string;
  /** The documents agreed to on the page before it left for the provider. */
  agree?: unknown;
}

const KEY = 'verified:';
export const TICKET_MINUTES = 10;

/** A ticket for an address proved, for the page to trade once. */
export async function ticketFor(control: Q, proved: Proved): Promise<string> {
  const ticket = newSecret('vt');
  await keep(control, KEY + sha256Hex(ticket), proved, TICKET_MINUTES * 60_000);
  return ticket;
}

const gone: Answered = { status: 410, body: { error: 'That sign-in has run out. Start again.' } };

/**
 * Trade a ticket: what is owed is asked first (the ticket is kept), then a guest map is kept or a workspace signed in to.
 * `owes` is the gate for the way in (keeping a map is asked as `keep`, signing in as `sign-in`).
 */
export async function finishVerified(at: KeepAt, owes: (via: Proved['for'], email: string, agree: unknown) => Promise<unknown[]>): Promise<Answered> {
  const control = await at.workspaces.control();
  const body = ((await at.body()) ?? {}) as { ticket?: unknown; agree?: unknown; workspace?: unknown };
  const key = KEY + sha256Hex(String(body.ticket ?? ''));
  const proved = await kept<Proved>(control, key);
  if (!proved) return gone;
  const agree = body.agree ?? proved.agree;
  if (proved.for === 'keep') {
    const owed = await owes('keep', proved.email, agree);
    if (owed.length) return { status: 200, body: { agree: owed } };
    if (!proved.workspace || !(await at.workspaces.has(proved.workspace)) || !(await take(control, key))) return gone;
    at.hold(proved.workspace);
    const ws = await at.workspaces.get(proved.workspace);
    const me = await ws.pelago.setting<string>('me');
    if (!me) return gone;
    return keepVerified(at, ws, me, proved.email, proved.machine);
  }
  const said = await signInAs({ ...at, owes: (email, given) => owes('sign-in', email, given) }, proved.email, body.workspace, agree);
  if ((said.body as { token?: string }).token && !(await take(control, key))) return gone;
  return said;
}
