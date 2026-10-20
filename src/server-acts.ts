// The server acts: the closed list of things a server pack may ask the kernel to do, each only if the pack declares
// it (src/server-packs.ts). A pack acts only on the workspaces it made itself: it can sell a workspace and sign its
// buyer in, never reach into another. Every act is logged on the default workspace's map with the pack that asked,
// so what a server pack did is in the owner's history like anything else.

import { setControlValue, controlValue } from './control.ts';
import { normalEmail, sendMail } from './mail.ts';
import { admitMember, linkFor, memberOf } from './members.ts';
import type { ServerAct, ServerPackFile } from './server-packs.ts';
import { validWorkspaceId } from './auth.ts';
import type { Workspaces } from './workspaces.ts';

export type ActPlaces = Pick<Workspaces, 'has' | 'get' | 'create'>;

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
export async function runAct(at: ActPlaces, pack: ServerPackFile, act: string, input: Record<string, unknown> = {}): Promise<unknown> {
  if (!(pack.acts ?? []).includes(act as ServerAct)) throw new Error(`The pack "${pack.id}" did not declare the act "${act}".`);
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
    case 'signin.link': {
      const ws = await itsOwn(at, pack.id, input.workspace);
      const email = normalEmail(input.email);
      if (!email || !(await memberOf(ws.pelago.db, email))) throw new Error(`${input.email} is not a member of "${ws.name}".`);
      const minutes = Math.min(Math.max(Number(input.minutes) || 30, 1), LINK_MOST_MINUTES);
      const link = await linkFor(ws.pelago.db, ws.id, email, minutes * 60_000);
      await log(`A sign-in link to "${ws.name}" for ${email}`, { workspace: ws.id, email, minutes });
      return { link };
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
