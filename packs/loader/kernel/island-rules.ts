// Which rules judge an op on an island that runs a version of its pack (task e_tykp9yfc, the plan "The harness refines
// itself through packs", e_e9526ead). Each op is judged by the rules of the island its items live on: a create by the
// island it is made on, an update, archive or forget by its item's, a link or unlink by both ends', a merge by both
// items'. An op on no island, or on one that runs the map's pack, is judged by the map's rules. What the rules then
// make of it is decide's alone (src/rules.ts): this only says which version each op runs under.

import { islandVersion } from './island-pin.ts';
import type { Archipelago } from '../../../src/pelago.ts';
import type { Op } from '../../../src/pelago-types.ts';
import type { IslandRun } from '../../../src/rules.ts';

/** For each op, the versions its islands run, undefined for an island on the map's (an empty list: the map's rules alone). */
export async function opRuns(map: Archipelago, ops: Op[]): Promise<(IslandRun | undefined)[][]> {
  const reg = map.registry;
  if (!reg.versions.size) return ops.map(() => []);
  const unlinks = ops.flatMap((op) => (op.op === 'unlink' ? [op.relation] : []));
  const ends = new Map(unlinks.length ? (await map.db.query<{ id: string; from_id: string; to_id: string }>(`select id, from_id, to_id from relation where id = any($1::text[])`, [unlinks])).rows.map((r) => [r.id, [r.from_id, r.to_id]]) : []);
  // What this change makes lives where its create puts it (placeOnIslands has placed it by now).
  const islands = new Map<string, string | undefined>(ops.flatMap((op) => (op.op === 'create' && op.ref ? [[op.ref, op.props?.island as string | undefined] as const, [`{${op.ref}}`, op.props?.island as string | undefined] as const] : [])));
  /** The island an item lives on, by id or by the ref this change makes it under; none for an item not found. */
  const islandOf = async (id: string | undefined) => {
    if (!id) return undefined;
    if (!islands.has(id)) islands.set(id, (await map.entity(id))?.props.island as string | undefined);
    return islands.get(id);
  };
  const runs = new Map<string, IslandRun | undefined>();
  const runOf = async (island: string) => {
    if (!runs.has(island)) runs.set(island, await islandVersion(map, island, reg));
    return runs.get(island);
  };
  return Promise.all(ops.map(async (op) => {
    const on: (string | undefined)[] =
      op.op === 'create' ? [op.props?.island as string | undefined]
      : op.op === 'link' ? [await islandOf(op.from), await islandOf(op.to)]
      : op.op === 'unlink' ? await Promise.all((ends.get(op.relation) ?? []).map(islandOf))
      : op.op === 'merge' ? [await islandOf(op.keep), await islandOf(op.drop)]
      : 'id' in op ? [await islandOf(op.id as string)] : [];
    // An end on an island that runs the map's pack (or on none) is judged by the map's rules too: undefined stands for them.
    const found = new Map<string, IslandRun | undefined>();
    for (const island of new Set(on)) {
      const run = typeof island === 'string' && island ? await runOf(island) : undefined;
      found.set(run?.version.item ?? '', run);
    }
    return found.size === 1 && found.has('') ? [] : [...found.values()];
  }));
}
