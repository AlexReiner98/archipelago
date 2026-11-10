// The server acts: the closed list of things a server pack may ask the kernel to do, each only if the pack declares
// it (src/server-packs.ts). These act only on the workspaces the pack made itself: it can sell a workspace and sign its
// buyer in, never reach into another; the one read beyond them is a public site's visit counts (site.visits),
// logged on that site's map. What it may do on a workspace whose admin connected it is in src/server-connect.ts. Every act is logged on the default workspace's map with the pack that asked,
// so what a server pack did is in the owner's history like anything else.

import { setControlValue, controlValue } from './control.ts';
import { normalEmail, sendMail } from './mail.ts';
import { admitMember, linkFor, memberOf, ownerEmail } from './members.ts';
import { madeKey } from './server-gates.ts';
import type { ServerAct, ServerPackFile } from './server-packs.ts';
import { env } from './env.ts';
import { readSites } from './site.ts';
import { visitsSince } from './visits.ts';
import { freeId } from './workspace-id.ts';
import type { Workspaces } from './workspaces.ts';

export type ActPlaces = Pick<Workspaces, 'has' | 'get' | 'create' | 'hold'>;

/** The longest a sign-in link a pack asks for works. */
const LINK_MOST_MINUTES = 7 * 24 * 60;

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

/** Hands what an address agreed to to the packs that keep it (src/server-gates.ts), answering the documents it still owes. */
export type Agrees = (ask: { email: string; agree: unknown; via: string }) => Promise<{ owes: { id: string; version: string }[] }>;

/** Do one act for a pack, if it declared it, and log it on the default map. Answers what the act gives back. */
export async function runAct(at: ActPlaces, pack: ServerPackFile, act: string, input: Record<string, unknown> = {}, agrees: Agrees = async () => ({ owes: [] })): Promise<unknown> {
  if (!(pack.reach.server.acts ?? []).includes(act as ServerAct)) throw new Error(`The pack "${pack.id}" did not declare the act "${act}".`);
  const owner = (await at.get('default')).pelago;
  const log = (reason: string, detail: Record<string, unknown>) => owner.log(owner.db, { actor: `pack:${pack.id}`, action: `server.${act}`, reason, detail });
  switch (act as ServerAct) {
    case 'workspace.create': {
      const name = text(input.name, 60, 'A workspace name');
      // Made with its owner, by their address: there is no workspace nobody can sign in to by email.
      const email = ownerEmail(input.email);
      const ws = await at.create(await freeId(at, name), name);
      await setControlValue(owner.db, madeKey(ws.id), pack.id);
      await admitMember(ws.pelago, email, true);
      await log(`Made the workspace "${name}" for ${email}`, { workspace: ws.id, email });
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
      const { owes } = await agrees({ email, agree: input.agreed, via: `pack:${pack.id}` });
      await log(`${email} agreed to the documents in force`, { workspace: ws.id, email, owes: owes.map((a) => a.id) });
      return { owes: owes.map(({ id, version }) => ({ id, version })) };
    }
    case 'site.visits': {
      // Counts only, of a site this server serves: the readers each tag brought, per day, added since `after`.
      const site = String(input.site ?? '').toLowerCase();
      const workspace = readSites(env('SITES'))[site];
      if (!workspace || !(await at.has(workspace))) throw new Error(`"${site}" is not a site this server serves.`);
      const after = input.after == null ? 0 : Number(input.after);
      if (!(Number.isInteger(after) && after >= 0)) throw new Error('after: a position of the visits stream, a whole number.');
      const { pelago } = await at.get(workspace);
      const read = await visitsSince(pelago, after);
      await pelago.log(pelago.db, { actor: `pack:${pack.id}`, action: `server.${act}`, reason: `Read the visits to ${site}: ${read.counts.length} rows`, detail: { site, after, rows: read.counts.length, pos: read.pos } });
      return read;
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
