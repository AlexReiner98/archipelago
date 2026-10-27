// The types and link types kept on the map, read for the registry (src/type-overlay.ts lays them over the packs), and
// the registry a change is checked and applied against when it makes or changes one.

import type { Registry } from './packs.ts';
import type { Archipelago, Op } from './pelago.ts';
import { LINK_ITEM, TYPE_ITEM, type TypeItem } from './type-overlay.ts';

const KINDS = [TYPE_ITEM, LINK_ITEM];

/** Told when the types kept on the map changed, so the type table follows (src/typetable.ts, set by src/workspaces.ts). */
let typesChanged: (l: Archipelago) => Promise<unknown> = async () => {};
export const onTypesChanged = (fn: (l: Archipelago) => Promise<unknown>) => (typesChanged = fn);

/** Every type and link type kept on the map, archived ones left out. */
export async function typeItems(l: Archipelago): Promise<TypeItem[]> {
  const { rows } = await l.db.query<TypeItem>(`select id, type, title, body, is_open, ${l.props} from entity where type = any($1::text[]) and archived_at is null order by created_at, id`, [KINDS]);
  return rows;
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
  const named = ops.flatMap((op, i) => (op.op === 'create' && KINDS.includes(op.type) ? [items.get(op.ref ?? `#${i + 1}`)!] : op.op === 'update' && items.has(op.id) ? [items.get(op.id)!] : []));
  const unresolved = named.filter((i) => typeof i.props.name === 'string' && !i.props.preset && !(i.type === LINK_ITEM ? trial.relations.has(i.props.name) : trial.type(i.props.name)));
  if (unresolved.length) throw new Error(`Change rejected:\n- the types it makes or changes: ${unresolved.map((i) => `"${String(i.props.name)}" extends no kind or type there is`).join('; ')}`);
  return trial;
}

/** After a change is applied: the types it defined taken in, and when it made or changed a type item, the registry and the type table brought in line. */
export async function typesApplied(l: Archipelago, ops: Op[], used: Registry): Promise<void> {
  for (const op of ops) if (op.op === 'define_type') await l.registry.defineLocal(op.type);
  if (used === l.registry) return;
  l.registry.takeItems(await typeItems(l));
  await typesChanged(l);
}
