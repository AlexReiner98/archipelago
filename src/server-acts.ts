// The server acts: the closed list of things a server pack may ask the kernel to do, each only if the pack declares
// it (src/server-packs.ts). These act only on the workspaces the pack made itself: it can sell a workspace and sign its
// buyer in, never reach into another. What it may do on a workspace whose admin connected it is in src/server-connect.ts. Every act is logged on the default workspace's map with the pack that asked,
// so what a server pack did is in the owner's history like anything else.

import { recordAgreement, type Agreement } from './agreements.ts';
import { setControlValue, controlValue } from './control.ts';
import { normalEmail, sendMail } from './mail.ts';
import { admitMember, linkFor, memberOf, setMemberLimit } from './members.ts';
import { setEnded } from './ended.ts';
import { LIMITS, limitsFrom } from './plan.ts';
import type { ServerAct, ServerPackFile } from './server-packs.ts';
import { validWorkspaceId } from './auth.ts';
import type { Workspaces } from './workspaces.ts';

export type ActPlaces = Pick<Workspaces, 'has' | 'get' | 'create' | 'hold'>;

/** Ids nobody's pack makes. */
const RESERVED = ['default', 'www', 'app', 'api', 'admin', 'mail', 'staging', 'archipelago', 'x'];
/** The longest a sign-in link a pack asks for works. */
const LINK_MOST_MINUTES = 7 * 24 * 60;

/** A workspace id from a name: its words, lowercase and joined by hyphens, with a number added if it is taken. */
export async function freeId(at: Pick<Workspaces, 'has'>, name: string): Promise<string> {
  const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '') || 'workspace';
  for (let n = 1; n < 1000; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (validWorkspaceId(id) && !RESERVED.includes(id) && !(await at.has(id))) return id;
  }
  throw new Error('No free workspace id for that name.');
}

const madeKey = (workspace: string) => `server_pack_made:${workspace}`;
const text = (v: unknown, most: number, what: string) => {
  const s = String(v ?? '').trim();
  if (!s || s.length > most) throw new Error(`${what}: up to ${most} characters.`);
  return s;
};

/** A workspace this pack made, or a refusal: a pack acts on no other. */
async function itsOwn(at: ActPlaces, pack: string, workspace: unknown) {
  const id = String(workspace ?? '');
  const control = (await at.get('default')).pelago.db;
  if (!(await at.has(id)) || (await controlValue<string>(control, madeKey(id))) !== pack) throw new Error(`"${id}" is not a workspace this pack made.`);
  return at.get(id);
}

/** Do one act for a pack, if it declared it, and log it on the default map. Answers what the act gives back. */
export async function runAct(at: ActPlaces, pack: ServerPackFile, act: string, input: Record<string, unknown> = {}, agreements: () => Promise<Agreement[]> = async () => []): Promise<unknown> {
  if (!(pack.reach.server.acts ?? []).includes(act as ServerAct)) throw new Error(`The pack "${pack.id}" did not declare the act "${act}".`);
  const owner = (await at.get('default')).pelago;
  const log = (reason: string, detail: Record<string, unknown>) => owner.log(owner.db, { actor: `pack:${pack.id}`, action: `server.${act}`, reason, detail });
  switch (act as ServerAct) {
    case 'workspace.create': {
      const name = text(input.name, 60, 'A workspace name');
      const ws = await at.create(await freeId(at, name), name);
      await setControlValue(owner.db, madeKey(ws.id), pack.id);
      await log(`Made the workspace "${name}"`, { workspace: ws.id });
      return { workspace: { id: ws.id, name: ws.name } };
    }
    case 'workspace.admit': {
      const ws = await itsOwn(at, pack.id, input.workspace);
      const email = normalEmail(input.email);
      if (!email) throw new Error('That is not an email address.');
      const person = await admitMember(ws.pelago, email, Boolean(input.admin));
      await log(`Added ${email} to "${ws.name}"`, { workspace: ws.id, email, admin: Boolean(input.admin) });
      return { person };
    }
    case 'workspace.limit': {
      // Each limit a plan sets (src/plan.ts) is sent whole every time: one left out is lifted. None at all lifts them all.
      const ws = await itsOwn(at, pack.id, input.workspace);
      const note = input.note == null || input.note === '' ? undefined : text(input.note, 300, 'The note');
      const plan = input.plan == null || input.plan === '' ? undefined : text(input.plan, 40, 'The plan');
      const manage = input.manage == null || input.manage === '' ? undefined : text(input.manage, 500, 'The manage link');
      if (manage && !/^https:\/\/[^\s"<>]+$/.test(manage)) throw new Error('The manage link is an https address.');
      const limits = limitsFrom(input, { note, plan, manage });
      await setMemberLimit(owner.db, ws.id, limits);
      const set = Object.fromEntries(LIMITS.filter((name) => limits?.[name]).map((name) => [name, limits![name]]));
      await log(limits ? `Set the limits of "${ws.name}"${plan ? ` to the ${plan} plan` : ''}: ${Object.entries(set).map(([n, v]) => `${n} ${v}`).join(', ')}` : `Lifted the limits of "${ws.name}"`, { workspace: ws.id, ...set });
      return { workspace: ws.id, ...set };
    }
    case 'workspace.end': {
      // Ended, the workspace is read-only and deleted after `days`; ended: false makes it writable again.
      const ws = await itsOwn(at, pack.id, input.workspace);
      if (input.ended === false) {
        await setEnded(owner.db, ws.id, null);
        await log(`"${ws.name}" is writable again`, { workspace: ws.id });
        return { workspace: ws.id, ended: false };
      }
      const days = Number(input.days ?? 30);
      if (!(Number.isInteger(days) && days >= 1 && days <= 365)) throw new Error('days: a whole number from 1 to 365.');
      const note = input.note == null || input.note === '' ? undefined : text(input.note, 300, 'The note');
      const manage = input.manage == null || input.manage === '' ? undefined : text(input.manage, 500, 'The manage link');
      if (manage && !/^https:\/\/[^\s"<>]+$/.test(manage)) throw new Error('The manage link is an https address.');
      const since = new Date();
      const ended = { since: since.toISOString(), delete_at: new Date(since.getTime() + days * 86_400_000).toISOString(), ...(note && { note }), ...(manage && { manage }) };
      await setEnded(owner.db, ws.id, ended);
      await log(`"${ws.name}" ended: read-only, deleted on ${ended.delete_at.slice(0, 10)}`, { workspace: ws.id, delete_at: ended.delete_at });
      return { workspace: ws.id, ended: true, delete_at: ended.delete_at };
    }
    case 'signin.link': {
      const ws = await itsOwn(at, pack.id, input.workspace);
      const email = normalEmail(input.email);
      if (!email || !(await memberOf(ws.pelago.db, email))) throw new Error(`${input.email} is not a member of "${ws.name}".`);
      const minutes = Math.min(Math.max(Number(input.minutes) || 30, 1), LINK_MOST_MINUTES);
      const link = await linkFor(ws.pelago.db, ws.id, email, minutes * 60_000);
      await log(`A sign-in link to "${ws.name}" for ${email}`, { workspace: ws.id, email, minutes });
      return { link };
    }
    case 'agreement.record': {
      // A buyer who ticked the box when they paid is not asked again at their first sign-in. Only a member of a
      // workspace the pack made, and only a version in force now: anything else is asked for at sign-in instead.
      const ws = await itsOwn(at, pack.id, input.workspace);
      const email = normalEmail(input.email);
      if (!email || !(await memberOf(ws.pelago.db, email))) throw new Error(`${input.email} is not a member of "${ws.name}".`);
      const owes = await recordAgreement(owner.db, email, input.agreed, await agreements(), `pack:${pack.id}`);
      await log(`${email} agreed to the documents in force`, { workspace: ws.id, email, owes: owes.map((a) => a.id) });
      return { owes: owes.map(({ id, version }) => ({ id, version })) };
    }
    case 'mail.send': {
      const to = normalEmail(input.to);
      if (!to) throw new Error('That is not an email address.');
      const subject = text(input.subject, 200, 'A subject');
      await sendMail({ to, subject, text: text(input.text, 20_000, 'The text') });
      await log(`Sent "${subject}" to ${to}`, { to });
      return { sent: true };
    }
  }
}
