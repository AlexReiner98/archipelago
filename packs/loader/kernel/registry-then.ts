// What a past registry (packs/loader/kernel/registry-at.ts) reads besides the pack facts: whether the map was on islands then, and the
// types the workspace had defined for itself (define_type) by then. Both are read from the logs, as of a fact position.

import type { Q } from '../../database/kernel/db.ts';
import { ISLANDS } from './islands.ts';
import type { TypeDef } from './packs.ts';

/**
 * Whether the map held its packs to the island rules at fact position `pos`: the last time the setting was said by
 * then (the settings stream, packs/loader/kernel/packstate.ts setIslands). Said only later, it was off then; never said (a map from
 * before settings were streamed, or one whose history is compacted away), today's stands.
 */
export async function islandsAt(q: Q, today: boolean, pos: number): Promise<boolean> {
  const until = (await q.query<{ at: Date }>(`select at from log_entry where stream = 'facts' and pos <= $1 order by pos desc limit 1`, [pos])).rows[0]?.at;
  if (!until) return false;
  const key = JSON.stringify([['+', 'setting', ISLANDS]]);
  const { rows: before } = await q.query<{ facts: unknown[][] }>(`select facts from log_op where stream = 'settings' and facts @> $1::jsonb and at <= $2 order by at desc, pos desc limit 1 -- index log_op_at`, [key, until]);
  if (before.length) return before[0].facts.find((f) => f[1] === 'setting' && f[2] === ISLANDS)?.[3] === true;
  const { rows: after } = await q.query(`select 1 from log_op where stream = 'settings' and facts @> $1::jsonb and at > $2 limit 1 -- index log_op_at`, [key, until]);
  return after.length ? false : today;
}

/** The workspace's own types (define_type), in the order they were defined, each as it was first said, of those it has today that were defined by fact position `pos`. */
export async function localAt(q: Q, ids: string[], pos: number): Promise<TypeDef[]> {
  if (!ids.length) return [];
  const { rows } = await q.query<{ value: TypeDef; pos: number }>(`select distinct on (id) id, value, pos from log_fact where stream = 'facts' and field = 'type_def' and id = any($1::text[]) and pos <= $2 order by id, pos, n -- index log_fact_history`, [ids, pos]);
  return rows.sort((a, b) => Number(a.pos) - Number(b.pos)).map((r) => r.value); // in the order they were defined
}
