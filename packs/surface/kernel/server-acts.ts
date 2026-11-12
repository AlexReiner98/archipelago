// The server acts: the closed list of things a server pack may ask the kernel to do, each only if the pack declares
// it (src/server-packs.ts). These act only on the workspaces the pack made itself: it can sell a workspace and sign its
// buyer in, never reach into another; beyond them, a pack keeps counts on a public site's map and reads them back
// (count.add, count.read: how many, never of whom), each read logged on that site's map. What it may do on a workspace whose admin connected it is in src/server-connect.ts. Every act is logged on the default workspace's map with the pack that asked,
// so what a server pack did is in the owner's history like anything else.

import { setControlValue, controlValue } from '../../../src/control.ts';
import { normalEmail, sendMail } from '../../../src/mail.ts';
import '../../loader/kernel/server-slots.ts'; // a workspace is made only where members' notices go out as mail
import { admitMember, linkFor, memberOf, ownerEmail } from '../../../src/members.ts';
import { madeKey } from './server-gates.ts';
import type { ServerAct, ServerPackFile } from '../../../src/server-packs.ts';
import { env } from '../../../src/env.ts';
import { readSites } from '../../../src/site.ts';
import { addCount, COUNT_KEY, countsSince, heldCounts } from '../../../src/pack-counts.ts';
import type { RootCall } from '../../../src/root-calls.ts';
import { freeId } from '../../../src/workspace-id.ts';
import type { Workspaces } from '../../../src/workspaces.ts';

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

/** The workspace of a site this server serves, by its domain, or a refusal. */
async function siteOf(at: ActPlaces, input: Record<string, unknown>) {
  const site = String(input.site ?? '').toLowerCase();
  const workspace = readSites(env('SITES'))[site];
  if (!workspace || !(await at.has(workspace))) throw new Error(`"${site}" is not a site this server serves.`);
  return { site, workspace };
}

const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * The map a pack's counts are kept on: a site this server serves, by its domain, or by its id a workspace that has a
 * public view, which anyone may open at /p/ whether or not it has a domain of its own (the owner, 11 Nov 2026,
 * e_hx5x4xhj). A workspace with nothing public takes no counts: there is nothing on it for anyone to visit.
 */
async function countedOn(at: ActPlaces, input: Record<string, unknown>) {
  if (input.site != null || input.workspace == null) return siteOf(at, input);
  const workspace = String(input.workspace);
  if (!WORKSPACE.test(workspace) || !(await at.has(workspace))) throw new Error(`"${workspace}" is not a workspace this server holds.`);
  const { rows } = await (await at.get(workspace)).pelago.db.query(`select 1 from public_view limit 1`);
  if (!rows.length) throw new Error(`"${workspace}" has no public view: counts are kept on a public site, or a workspace with something public.`);
  return { site: workspace, workspace };
}

/** Read the counts kept in a stream on a site's or a public workspace's map after a position, logged there. */
async function readCounts(at: ActPlaces, pack: ServerPackFile, act: string, input: Record<string, unknown>, stream: string | undefined) {
  const { site, workspace } = await countedOn(at, input);
  const after = input.after == null ? 0 : Number(input.after);
  if (!(Number.isInteger(after) && after >= 0)) throw new Error('after: a position of the counts stream, a whole number.');
  const { pelago } = await at.get(workspace);
  const read = stream ? await countsSince(pelago, stream, after) : { counts: [], pos: after };
  await pelago.log(pelago.db, { actor: `pack:${pack.id}`, action: `server.${act}`, reason: `Read the counts on ${site}: ${read.counts.length} rows`, detail: { site, after, rows: read.counts.length, pos: read.pos, ...(input.of != null && { of: String(input.of) }) } });
  return read;
}

/**
 * Do one act for a pack, if it declared it, and log it on the default map. Answers what the act gives back. `packs` are
 * the server's packs, whose counts a pack may read.
 */
export async function runAct(at: ActPlaces, pack: ServerPackFile, act: string, input: Record<string, unknown> = {}, agrees: Agrees = async () => ({ owes: [] }), packs: ServerPackFile[] = [pack]): Promise<unknown> {
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
    case 'count.add': {
      // A pack's count on a site's map, held in memory and written down each minute (src/pack-counts.ts); the day is the server's.
      const stream = pack.reach.server.counts;
      if (!stream) throw new Error(`The pack "${pack.id}" names no stream for its counts (counts).`);
      const key = String(input.key ?? '');
      if (!COUNT_KEY.test(key)) throw new Error('key: 1 to 40 letters, digits, _ and -.');
      const n = input.n == null ? 1 : Number(input.n);
      if (!(Number.isInteger(n) && n >= 1 && n <= 1000)) throw new Error('n: a whole number from 1 to 1000.');
      addCount((await countedOn(at, input)).workspace, stream, key, undefined, n);
      return { counted: true };
    }
    case 'count.read': {
      // Counts only, of a site this server serves: what was added to each key's day after `after`, its own or another pack's.
      const of = input.of == null ? pack.id : String(input.of);
      return readCounts(at, pack, act, input, packs.find((p) => p.id === of)?.reach.server.counts);
    }
    case 'site.visits': {
      // Kept for one release, until its readers ask count.read: the counts of the pack that takes the site mount, keys as tags.
      const read = await readCounts(at, pack, act, input, packs.find((p) => p.reach.server.mounts?.site)?.reach.server.counts);
      return { counts: read.counts.map(({ key, day, n }) => ({ tag: key, day, n })), pos: read.pos };
    }
    case 'mail.send': {
      const to = normalEmail(input.to);
      if (!to) throw new Error('That is not an email address.');
      const subject = text(input.subject, 200, 'A subject');
      // A way out of mail that sells: one of the pack's own entries, on https, which a mail program POSTs to.
      const unsubscribe = input.unsubscribe == null ? undefined : String(input.unsubscribe);
      if (unsubscribe !== undefined) {
        const u = URL.canParse(unsubscribe) ? new URL(unsubscribe) : undefined;
        if (u?.protocol !== 'https:' || !u.pathname.startsWith(`/x/${pack.id}/`)) throw new Error(`unsubscribe: an https address of one of this pack's own entries (/x/${pack.id}/...).`);
      }
      await sendMail({ to, subject, text: text(input.text, 20_000, 'The text'), ...(unsubscribe && { unsubscribe }) });
      await log(`Sent "${subject}" to ${to}`, { to });
      return { sent: true };
    }
  }
}

/** The kernel's stream of uses (core's rule uses): what the Packs screen counts. */
const USES = 'uses';

/**
 * root.uses (docs/kernel-packs.md, "Root services"): the uses of a workspace's declarations, counted in the server's
 * memory until they are written down each minute with the rest of the counts (keepCounts). `add` adds to them; `held`
 * answers what is not yet written, as rows of key, day and n. The workspace is the caller's map's; a caller with no map
 * (the kernel's, which names only a workspace) names it.
 */
export function usesOf(call: RootCall, input: { workspace?: string; add?: { key: string; n?: number }[]; held?: boolean }) {
  const workspace = call.map?.workspace ?? input.workspace;
  if (typeof workspace !== 'string' || !workspace) throw new Error('root.uses counts a workspace: call it from its map, or name it');
  if (call.map && input.workspace !== undefined && input.workspace !== workspace) throw new Error('root.uses counts only the map that calls it');
  for (const { key, n = 1 } of input.add ?? []) {
    if (typeof key !== 'string' || !key || !(Number.isInteger(n) && n >= 1)) throw new Error('root.uses adds a key and a whole number');
    addCount(workspace, USES, key, undefined, n);
  }
  return input.held ? heldCounts(workspace, USES) : { counted: (input.add ?? []).length };
}
