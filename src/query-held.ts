// The lens term `held` (the owner, 31 Oct 2026): the items that a change held for the viewer would touch. What a held
// change would create is no item yet, so the page draws it as a faint node beside these (ui/ghosts.js). Held changes are
// read as the viewer may see them (row-level security on the proposal), so a change held for someone else is not here.

import type { Archipelago, Op } from './pelago.ts';

/** The ids a change's ops name, as written: an end that is a ref of the same change is no item, and finds nothing. */
const named = (ops: Op[]): string[] =>
  ops.flatMap((o) => {
    const at = o as unknown as Record<string, unknown>;
    return ['id', 'keep', 'drop', 'from', 'to'].flatMap((k) => (typeof at[k] === 'string' ? [at[k] as string] : []));
  });

/** The items the viewer's pending held changes would edit, archive, merge or tie, and the ends of a link they would end. */
export async function heldIds(l: Archipelago): Promise<string[]> {
  const ops = (await l.proposals()).flatMap((p) => p.ops as Op[]);
  const ids = new Set(named(ops));
  const ended = ops.flatMap((o) => (o.op === 'unlink' ? [o.relation] : []));
  if (ended.length) {
    const { rows } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where id = any($1::text[])`, [ended]);
    for (const r of rows) (ids.add(r.from_id), ids.add(r.to_id));
  }
  return [...ids];
}
