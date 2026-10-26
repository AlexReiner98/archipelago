// A server pack connected to a workspace: what its admin grants by connecting it, and nothing more. They begin it
// here (the kernel makes a one-time word, state, tied to their workspace, and the pack says where to send them); the
// pack finishes it when they come back with that word, and the account they chose outside (a connection: its id
// there and a name) is that workspace's from then on. While it is connected, and only then, the pack may ask for two
// acts on that workspace: add items to its map (only what is not there by its address), and hand a delivery to the
// pack in it that takes that kind of event in. Each is logged in that workspace, except a delivery handed over only
// to ask what the pack there makes of it (ask): that pack writes nothing. Disconnecting takes it all away.
//
// Connections are kept in the control plane (control_value, one key each: the first server to write one has it);
// the words begun are kept for a quarter of an hour, under a name the pack's own store cannot reach.

import { randomBytes } from 'node:crypto';
import { claimControlValue, controlValue, storeGet, storePut, storeTake } from './control.ts';
import type { Q } from './db.ts';
import { askHook, hookFor, runHook } from './hooks.ts';
import type { Archipelago, Op } from './pelago.ts';
import type { ServerPackFile } from './server-packs.ts';
import type { Workspaces } from './workspaces.ts';

export type ConnectPlaces = Pick<Workspaces, 'has' | 'get' | 'hold'>;

export interface Connection {
  id: string;
  workspace: string;
  account: string;
}

/** How long someone has to finish outside what they began here. */
const BEGUN_MS = 15 * 60_000;
const ID = /^[\w.-]{1,100}$/;
const connectionKey = (pack: string, id: string) => `connection:${pack}:${id}`;
/** The words a pack's connections were begun with: in its store's table, under a name no pack id can have. */
const begunStore = (pack: string) => `kernel:${pack}`;

export async function connectionById(control: Q, pack: string, id: string): Promise<Connection | undefined> {
  const found = await controlValue<{ workspace: string; account: string }>(control, connectionKey(pack, id));
  return found && { id, ...found };
}

/** The connection a workspace made to a pack, if it has. */
export async function connectionOf(control: Q, pack: string, workspace: string): Promise<Connection | undefined> {
  const prefix = connectionKey(pack, '');
  const { rows } = await control.query<{ key: string; value: { workspace: string; account: string } }>(
    `select key, value from control_value where left(key, length($1)) = $1 and value->>'workspace' = $2 order by key limit 1`,
    [prefix, workspace],
  );
  return rows[0] && { id: rows[0].key.slice(prefix.length), ...rows[0].value };
}

/** Forget a connection; with no id, every one a workspace made to the pack. Answers what was forgotten. */
export async function dropConnections(control: Q, pack: string, by: { id?: string; workspace?: string }): Promise<Connection[]> {
  const prefix = connectionKey(pack, '');
  const { rows } = await control.query<{ key: string; value: { workspace: string; account: string } }>(
    `delete from control_value where left(key, length($1)) = $1 and ($2::text is null or key = $1 || $2) and ($3::text is null or value->>'workspace' = $3) returning key, value`,
    [prefix, by.id ?? null, by.workspace ?? null],
  );
  return rows.map((r) => ({ id: r.key.slice(prefix.length), ...r.value }));
}

/** Begin connecting (or, in the default workspace, setting up) a pack: the one-time word that ties the way back to here. */
export async function begin(control: Q, pack: string, purpose: 'connect' | 'setup', workspace: string): Promise<string> {
  const state = `${workspace}.${randomBytes(24).toString('hex')}`;
  await storePut(control, begunStore(pack), state, { purpose, workspace }, BEGUN_MS);
  return state;
}

async function begun(control: Q, pack: string, state: unknown, take: boolean) {
  if (typeof state !== 'string' || !/^[a-z0-9-]+\.[0-9a-f]{48}$/.test(state)) return undefined;
  return take ? storeTake<{ purpose: string; workspace: string }>(control, begunStore(pack), state) : storeGet<{ purpose: string; workspace: string }>(control, begunStore(pack), state);
}

/**
 * Whether two addresses are of the same place, however each was written: the scheme, a user before the host, ".git"
 * and a trailing slash aside, and a page within it (…/tree/main) the same as the place itself.
 */
export function samePlace(a: unknown, b: unknown): boolean {
  const place = (url: unknown) =>
    String(url ?? '')
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/^[^@/]+@([^:/]+):(?!\d)/, '$1/')
      .replace(/^[^@/]+@/, '')
      .replace(/[?#].*$/, '')
      .replace(/\.git(?=\/|$)/, '')
      .replace(/\/+$/, '');
  const [x, y] = [place(a), place(b)];
  return Boolean(x && y) && (x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`));
}

const text = (v: unknown, most: number, what: string) => {
  const s = String(v ?? '').trim();
  if (!s || s.length > most) throw new Error(`${what}: up to ${most} characters.`);
  return s;
};

/** Add to a workspace's map what is not there yet by its address: only new items, as its admin's choice when connecting. */
async function addItems(l: Archipelago, pack: ServerPackFile, connection: Connection, input: Record<string, unknown>) {
  const type = text(input.type, 80, 'A type');
  const unique = text(input.unique, 40, 'The field that says where each one is');
  const def = l.registry.type(type);
  if (!def || !def.fields[unique]) throw new Error(`This workspace has no type "${type}" with a field "${unique}": turn on the pack that has it.`);
  const items = Array.isArray(input.items) ? (input.items as { title?: unknown; props?: Record<string, unknown> }[]) : [];
  if (!items.length || items.length > 200) throw new Error('items: one to 200, each a title and props.');
  const { rows } = await l.db.query<{ value: unknown }>(`select props->$2 as value from entity where type = any($1::text[]) and archived_at is null and props ? $2`, [l.registry.family(type), unique]);
  const added: string[] = [];
  const known: string[] = [];
  const ops: Op[] = [];
  for (const item of items) {
    const title = text(item.title, 60, 'A title');
    const props = item.props && typeof item.props === 'object' ? item.props : {};
    if (rows.some((r) => samePlace(r.value, props[unique])) || ops.some((o) => o.op === 'create' && samePlace(o.props?.[unique], props[unique]))) known.push(title);
    else {
      added.push(title);
      ops.push({ op: 'create', type, title, props });
    }
  }
  if (ops.length)
    await l.apply(`pack:${pack.id}`, { ops, reason: text(input.reason ?? `Connected through ${pack.title}`, 200, 'A reason') }, {
      authority: { of: 'human', basis: `Chosen when ${pack.title} was connected${connection.account ? ` to ${connection.account}` : ''}`, stated_by: `pack:${pack.id}` },
    });
  return { added, known };
}

/** Do one of the connection acts for a pack. */
export async function connectAct(at: ConnectPlaces, control: Q, pack: ServerPackFile, act: string, input: Record<string, unknown>): Promise<unknown> {
  switch (act) {
    case 'begun.get':
    case 'begun.take': {
      const found = await begun(control, pack.id, input.state, act === 'begun.take');
      if (!found) throw new Error('This was not started from Archipelago, or was started too long ago. Start again from the Workspace screen.');
      return found;
    }
    case 'connection.get':
      return (await connectionById(control, pack.id, String(input.id ?? ''))) ?? null;
  }
  const id = String(input.id ?? input.connection ?? '');
  if (!ID.test(id)) throw new Error('A connection is named by the id of the account outside: letters, digits, _.-');
  if (act === 'connection.make') {
    const was = await begun(control, pack.id, input.state, true);
    if (!was || was.purpose !== 'connect') throw new Error('This was not started from Archipelago, or was started too long ago. Start again from the Workspace screen.');
    if (!(await at.has(was.workspace))) throw new Error(`There is no workspace "${was.workspace}" any more.`);
    const account = String(input.account ?? '').slice(0, 100);
    // Another server may have tied it to another workspace meanwhile: the first to write it has it.
    if (!(await claimControlValue(control, connectionKey(pack.id, id), { workspace: was.workspace, account }))) {
      const had = await connectionById(control, pack.id, id);
      if (had?.workspace !== was.workspace) throw new Error('That account is already connected to another workspace.');
      if (had.account !== account) await control.query(`update control_value set value = $2::jsonb where key = $1`, [connectionKey(pack.id, id), JSON.stringify({ workspace: was.workspace, account })]);
    }
    const { pelago } = await at.get(was.workspace);
    await pelago.log(pelago.db, { actor: `pack:${pack.id}`, action: 'connection.made', reason: `Connected ${pack.title}${account ? ` to ${account}` : ''}`, detail: { pack: pack.id, connection: id, account } });
    return { workspace: was.workspace, connection: id, account };
  }
  const connection = await connectionById(control, pack.id, id);
  if (act === 'connection.drop') {
    for (const c of await dropConnections(control, pack.id, { id })) {
      if (!(await at.has(c.workspace))) continue;
      const { pelago } = await at.get(c.workspace);
      await pelago.log(pelago.db, { actor: `pack:${pack.id}`, action: 'connection.ended', reason: `${pack.title} was removed${c.account ? ` from ${c.account}` : ''}, outside`, detail: { pack: pack.id, connection: id } });
    }
    return { dropped: Boolean(connection) };
  }
  // The two acts on a workspace: only one that connected the pack, while it is connected.
  if (!connection || !(await at.has(connection.workspace))) throw new Error(`No workspace here has connected "${id}".`);
  const release = at.hold(connection.workspace);
  try {
    const { pelago } = await at.get(connection.workspace);
    if (act === 'workspace.add') {
      const done = await addItems(pelago, pack, connection, input);
      await pelago.log(pelago.db, { actor: `pack:${pack.id}`, action: 'server.workspace.add', reason: `${pack.title}: ${done.added.length} added, ${done.known.length} there already`, detail: { pack: pack.id, connection: id, ...done } });
      return done;
    }
    if (act === 'workspace.deliver') {
      const event = text(input.event, 80, 'The kind of event');
      const takes = hookFor(pelago, event);
      if (!takes) return { recorded: false, reason: `No pack in this workspace takes "${event}" in: turn it on first.` };
      const headers = input.headers && typeof input.headers === 'object' ? (input.headers as Record<string, unknown>) : {};
      // A question about a delivery (ask): the pack there answers it and writes nothing, so nothing is logged.
      if (input.ask === true) return ((await askHook(pelago, takes.pack, takes.hook, { payload: input.payload, headers })) ?? {}) as Record<string, unknown>;
      await pelago.log(pelago.db, { actor: `pack:${pack.id}`, action: 'server.workspace.deliver', reason: `${pack.title} handed ${takes.pack} a ${event}`, detail: { pack: pack.id, connection: id, to: takes.pack, event } });
      // What the pack there records, the packs that hear it are told of.
      return ((await runHook(pelago, takes.pack, takes.hook, { payload: input.payload, headers })).answer ?? {}) as Record<string, unknown>;
    }
  } finally {
    release();
  }
  throw new Error(`"${act}" is not an act on a connected workspace.`);
}
