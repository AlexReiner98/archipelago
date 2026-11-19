// The registry as a projection of the log (one tier, e_k8nqby7n; this lane e_678v4axv), as packs/log/kernel/replay.ts
// projects the tables: built from the seed (packs/loader/kernel/pack-source.ts) and the system items on the map, and cached by
// the position on the fact stream it was built at. When the log moves on, only the facts after that position are read,
// and the registry is built again only when one of them touches a system item (an item of a kind the pack model names,
// or a link to one). Every reader, rule checks first, keeps reading the registry it has, in memory, as before.
//
// Per-island registries (packs/loader/kernel/island-pin.ts, Registry.trial) are built from this one as they were: whether a
// version of a pack becomes an item of its own is still open (e_ydbb24qj), so nothing here decides it.

import type { Archipelago } from '../../write/kernel/pelago.ts';
import { systemKinds, type SystemItem } from './pack-source.ts';

/** Where a map's registry was last built from the log: the fact position, the system items' ids, and those items as read. */
interface Built { pos: number; ids: Set<string>; said: string }
const built = new WeakMap<Archipelago, Built>();

/** More facts than this since the last position and the items are read again rather than the facts: one bounded read either way. */
const SCAN = 2000;

/** The fact stream's position now: 0 on a map with no change yet. */
export async function factsHead(l: Archipelago): Promise<number> {
  const { rows } = await l.db.query<{ pos: string }>(`select pos from log_entry where stream = 'facts' order by pos desc limit 1`);
  return Number(rows[0]?.pos ?? 0);
}

/** The system items on the map now, archived ones left out, in the order they were made. */
export async function systemItems(l: Archipelago): Promise<SystemItem[]> {
  const { rows } = await l.db.query<SystemItem>(`select id, type, title, body, is_open, ${l.props} from entity where type = any($1::text[]) and archived_at is null order by created_at, id`, [systemKinds()]);
  return rows;
}

/** Whether the facts after position `after`, up to `upto`, touch a system item: one the registry was built from, one of a system kind, or a link to one. */
export async function touchesSystem(l: Archipelago, after: number, upto: number, ids: Set<string>): Promise<boolean> {
  const { rows } = await l.db.query<{ id: string }>(`select distinct id from log_fact where stream = 'facts' and pos > $1 and pos <= $2`, [after, upto]);
  if (rows.some((r) => ids.has(r.id))) return true;
  const items = rows.filter((r) => r.id.startsWith('e_')).map((r) => r.id), links = rows.filter((r) => r.id.startsWith('r_')).map((r) => r.id);
  const kinds = systemKinds();
  if (items.length && (await l.db.query(`select 1 from entity where id = any($1::text[]) and type = any($2::text[]) limit 1`, [items, kinds])).rows.length) return true;
  return links.length > 0 && (await l.db.query(`select 1 from relation r join entity e on e.id = r.from_id or e.id = r.to_id where r.id = any($1::text[]) and e.type = any($2::text[]) limit 1`, [links, kinds])).rows.length > 0;
}

/** Record the registry as built at `pos` from these items, and take them in when they differ from what it was built from. Says whether it was built again. */
function take(l: Archipelago, pos: number, items: SystemItem[], strict: boolean): boolean {
  const said = JSON.stringify(items), was = built.get(l), ids = new Set(items.map((i) => i.id));
  if (was?.said === said) return built.set(l, { pos, ids, said }), false;
  try {
    l.registry.takeItems(items);
  } catch (err) {
    if (strict) throw err;
    // kept at this position, as built from what it had: a follow does not try the same items every beat, a change to them does
    built.set(l, { pos, ids: new Set([...ids, ...(was?.ids ?? [])]), said: was?.said ?? '' });
    console.error(`the system items in ${l.workspace} do not load: ${(err as Error).message}`);
    return false;
  }
  built.set(l, { pos, ids, said });
  return true;
}

/**
 * Bring a map's registry up to the log: nothing read but the head when the log has not moved, the facts since when it
 * has, and the items again only when those facts touch a system item. Says whether the registry was built again. The
 * head is read before the items, so a change that lands in between is read on the next follow.
 */
export async function followRegistry(l: Archipelago): Promise<boolean> {
  const head = await factsHead(l), was = built.get(l);
  if (was && was.pos === head) return false;
  if (was && head > was.pos && head - was.pos <= SCAN && !(await touchesSystem(l, was.pos, head, was.ids))) return (was.pos = head), false;
  return take(l, head, await systemItems(l), false);
}

/**
 * Build a map's registry from the system items now, and these besides (a backup's, before it is merged): what follows
 * a change that made or changed one. One that does not load is thrown, and the registry stays as it was.
 */
export async function rebuildRegistry(l: Archipelago, besides: SystemItem[] = []): Promise<void> {
  const head = await factsHead(l), here = await systemItems(l);
  const items = [...here, ...besides.filter((b) => !here.some((i) => i.id === b.id))];
  take(l, head, items, true);
  if (besides.length) built.delete(l); // what a backup brought is not on the log yet: the next follow reads the items again
}

/** The fact position a map's registry was last built at, or brought up to: undefined before the first. */
export const builtAt = (l: Archipelago): number | undefined => built.get(l)?.pos;
