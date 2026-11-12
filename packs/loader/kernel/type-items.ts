// The types and link types kept on the map, read for the registry (src/type-overlay.ts lays them over the packs), and
// the registry a change is checked and applied against when it makes or changes one.

import type { Registry, TypeDef } from './packs.ts';
import type { Archipelago, Op } from '../../../src/pelago.ts';
import { PACK_ITEM } from './pack-items.ts'; import { versionRegistry } from './island-pin.ts';
import { LINK_ITEM, TYPE_ITEM, type TypeItem } from './type-overlay.ts';
import { followMade } from './packstate.ts';
import { syncTypes } from './typetable.ts';

/** What the registry reads from the map: types, link types, and packs made there (src/pack-items.ts). */
const KINDS = [TYPE_ITEM, LINK_ITEM, PACK_ITEM];

/** Told when the types kept on the map changed, so the type table follows (src/typetable.ts); a test may set another. */
let typesChanged: (l: Archipelago) => Promise<unknown> = (l) => syncTypes(l);
export const onTypesChanged = (fn: (l: Archipelago) => Promise<unknown>) => (typesChanged = fn);
/** Told when a pack kept as an item was made or changed, so the log and the packs on follow (src/packstate.ts). */
let packsChanged: (l: Archipelago) => Promise<unknown> = (l) => followMade(l);
export const onPacksChanged = (fn: (l: Archipelago) => Promise<unknown>) => (packsChanged = fn);

/**
 * An op naming a type or link type by a name it had before (work.task) names it as it is now (task), and a define_type
 * is the type item it makes: one way to make a type. Set in place, so a held change and its proposal read alike.
 */
export function currentNames(reg: Registry, ops: Op[]): void {
  for (const [i, op] of ops.entries()) {
    if (op.op === 'define_type') ops[i] = asTypeItem(op.type);
    else if (op.op === 'create' || op.op === 'link') op.type = reg.canonical(op.type);
  }
}

/** A type as define_type gives it, as the `type` item that keeps it on the map. */
function asTypeItem(def: TypeDef): Op {
  const { id, title, description, extends: parent, fields, statuses, deliverable } = def;
  const props = { name: id, ...(parent && { extends: parent }), ...(fields && { fields }), ...(statuses && { statuses }), ...(deliverable && { deliverable: true }) };
  return { op: 'create', type: TYPE_ITEM, title, ...(description && { body: description }), props };
}

/** Every type and link type kept on the map, archived ones left out. */
export async function typeItems(l: Archipelago): Promise<TypeItem[]> {
  const { rows } = await l.db.query<TypeItem>(`select id, type, title, body, is_open, ${l.props} from entity where type = any($1::text[]) and archived_at is null order by created_at, id`, [KINDS]);
  return rows;
}

/** The type items each open workspace's registry last took, to follow another server's change to them. */
const taken = new WeakMap<Archipelago, string>();

/** Take in the types and link types kept on the map, when they changed: ones that no longer load (a pack gone) are said, and left out. */
export async function takeTypeItems(pelago: Archipelago): Promise<boolean> {
  const items = await typeItems(pelago);
  const now = JSON.stringify(items);
  if (taken.get(pelago) === now) return false;
  taken.set(pelago, now);
  try {
    pelago.registry.takeItems(items);
  } catch (err) {
    console.error(`the types kept on the map in ${pelago.workspace} do not load: ${(err as Error).message}`);
    return false;
  }
  return true;
}

/**
 * The registry a change is checked and applied against: the workspace's own, or, when the change makes or changes a
 * type or link type, one with those as they will be, so a type made in a change can be used in it.
 */
export async function typesAfter(l: Archipelago, ops: Op[]): Promise<Registry> {
  const reg = l.registry;
  const ids = ops.flatMap((op) => ('id' in op && typeof op.id === 'string' && op.op !== 'forget' ? [op.id] : []));
  const { rows: touched } = ids.length ? await l.db.query<{ id: string }>(`select id from entity where id = any($1::text[]) and type = any($2::text[])`, [ids, KINDS]) : { rows: [] };
  const ours = new Set(touched.map((r) => r.id));
  if (!ours.size && !ops.some((op) => op.op === 'create' && KINDS.includes(op.type))) return reg;
  const items = new Map((await typeItems(l)).map((i) => [i.id, i]));
  const restored = ops.flatMap((op) => (op.op === 'restore' && ours.has(op.id) ? [op.id] : []));
  const { rows: back } = restored.length ? await l.db.query<TypeItem>(`select id, type, title, body, is_open, ${l.props} from entity where id = any($1::text[])`, [restored]) : { rows: [] };
  for (const [i, op] of ops.entries()) {
    if (op.op === 'create' && KINDS.includes(op.type)) {
      const key = op.ref ?? `#${i + 1}`;
      items.set(key, { id: key, type: op.type, title: op.title, body: op.body ?? '', is_open: reg.isOpen(op.type, op.status ?? 'current'), props: op.props ?? {} });
    } else if (op.op === 'update' && items.has(op.id)) {
      const was = items.get(op.id)!;
      const props = Object.fromEntries(Object.entries({ ...was.props, ...op.props }).filter(([, v]) => v !== null));
      items.set(op.id, { ...was, title: op.title ?? was.title, body: op.body ?? was.body, is_open: op.status ? reg.isOpen(was.type, op.status) : was.is_open, props });
    } else if (op.op === 'archive' && ours.has(op.id)) items.delete(op.id);
    else if (op.op === 'restore') for (const row of back.filter((r) => r.id === op.id)) items.set(row.id, row);
  }
  let trial: Registry;
  try {
    trial = reg.trial([...items.values()]);
  } catch (err) {
    throw new Error(`Change rejected:\n- the types it makes or changes: ${(err as Error).message}`);
  }
  // The registry leaves a workspace's own type that does not resolve to the type table (its pack turned off); one this change makes must resolve.
  const written = ops.flatMap((op, i) => (op.op === 'create' && KINDS.includes(op.type) ? [items.get(op.ref ?? `#${i + 1}`)!] : op.op === 'update' && items.has(op.id) ? [items.get(op.id)!] : []));
  const named = written.filter((i) => i.type !== PACK_ITEM);
  const packs = written.filter((i) => i.type === PACK_ITEM);
  const wrong = packs.flatMap((i) => (trial.madeWrong.has(i.id) ? [`the pack ${String(i.props.name ?? i.title)}: ${trial.madeWrong.get(i.id)}`] : []));
  if (wrong.length) throw new Error(`Change rejected:\n- ${wrong.join('\n- ')}`);
  // A pack made here is checked whole as if the owner had added it, so one that would not load is refused now, not when it is turned on.
  const names = packs.filter((i) => i.is_open && !i.props.version_of).map((i) => String(i.props.name));
  if (names.length) {
    let added: Registry;
    try {
      added = reg.trial([...items.values()], names);
    } catch (err) {
      throw new Error(`Change rejected:\n- the pack ${names.join(', ')}, as it would be once added: ${(err as Error).message}`);
    }
    // Off even once added: the island rules do not take it (one that waits for a pack still to come is let be).
    const refused = names.flatMap((n) => (added.states.get(n)?.state === 'off' ? [`the pack ${n} is ${added.states.get(n)!.why}`] : []));
    if (refused.length) throw new Error(`Change rejected:\n- ${refused.join('\n- ')}`);
  }
  // A version of a pack is checked as an island would run it, so one that would not load is refused now, not when an island names it.
  const broken = packs.filter((i) => i.is_open && i.props.version_of).flatMap((i) => { const run = versionRegistry(trial, i.id); return run instanceof Error ? [`the version ${i.title} of ${String(i.props.version_of)}: ${run.message}`] : []; });
  if (broken.length) throw new Error(`Change rejected:\n- ${broken.join('\n- ')}`);
  // A workspace's own is named local.<name>, so a pack added later never takes its name.
  const misnamed = named.filter((i) => typeof i.props.name === 'string' && !i.props.preset && !/^local\.[a-z][a-z0-9_]*$/.test(i.props.name));
  if (misnamed.length) throw new Error(`Change rejected:\n- the types it makes or changes: ${misnamed.map((i) => `"${String(i.props.name)}" must be named "local.<name>"`).join('; ')}`);
  const unresolved = named.filter((i) => typeof i.props.name === 'string' && !i.props.preset && !(i.type === LINK_ITEM ? trial.relations.has(i.props.name) : trial.type(i.props.name)));
  if (unresolved.length) throw new Error(`Change rejected:\n- the types it makes or changes: ${unresolved.map((i) => `"${String(i.props.name)}" extends no type there is`).join('; ')}`);
  return trial;
}

/** After a change is applied: when it made or changed a type item, the registry and the type table brought in line. */
export async function typesApplied(l: Archipelago, ops: Op[], used: Registry): Promise<void> {
  if (used === l.registry) return;
  await typesTaken(l);
  // a pack kept as an item may have come, changed or gone with it: the log and the packs on follow.
  if (l.registry.made.size || used.made.size) await packsChanged(l);
}

/** The registry and the type table brought in line with the type items on the map, and these besides (a backup's, before it is merged). */
export async function typesTaken(l: Archipelago, besides: TypeItem[] = []): Promise<void> {
  const here = await typeItems(l);
  l.registry.takeItems([...here, ...besides.filter((b) => !here.some((i) => i.id === b.id))]);
  await typesChanged(l);
}

/** A backup's type items: its own types (a name, no preset) are what its items may need. */
export const typeItemsIn = (rows: Record<string, unknown>[]): TypeItem[] =>
  rows.filter((r) => KINDS.includes(r.type as string) && !r.archived_at).map((r) => ({ id: r.id as string, type: r.type as string, title: r.title as string, body: (r.body as string) ?? '', is_open: r.is_open !== false, props: (r.props as Record<string, unknown>) ?? {} }));
