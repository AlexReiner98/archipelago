// The reads the clocks pack's pass needs (packs/clocks/kernel/due.ts): where the last pass stood and the zone days are
// counted in, the open items of the types that happen at a time, and what a hearer of item.due is told an item came
// due under (its version and the packs of its island). Each is bounded by the types or the id it is given, and answered
// as the map that asks, under row-level security, as every read of packreads.ts is.

import type { Archipelago, Entity } from '../../write/kernel/pelago.ts';
import { packVersionsFor, type PackVersion } from '../../loader/kernel/pack-versions.ts';

export type ClocksRead = {
  /** The clock's pass at `now`: where the last stood (undefined the first time) and the workspace's time zone, and the clock moved to now. The clocks pack's alone. */
  clock?: { now: number };
  /** The open, live items of these types, every column: what may come due by its when. */
  timed?: string[];
  /** What an item came due under: its version (the position of its last fact) and the packs its island runs. */
  due_of?: string;
};

/** The reads of this module, by name. */
const CLOCKS_READS = ['clock', 'timed', 'due_of'] as const satisfies readonly (keyof ClocksRead)[];
/** Where the clock stands, kept in the workspace's settings as it was before the clock moved to its pack. */
const CURSOR = 'due_cursor';
/** The pack whose pass the clock is. */
const CLOCKS = 'clocks';

/** The answer to one of these reads, or undefined when the read is none of them. `pack` is the internal pack asking. */
export async function clocksRead(l: Archipelago, q: ClocksRead, pack?: string): Promise<unknown> {
  const asked = CLOCKS_READS.find((k) => q[k] !== undefined);
  if (!asked) return undefined;
  if (!pack) throw new Error(`Only the server's own packs read ${asked}`);
  if (q.clock !== undefined) {
    if (pack !== CLOCKS) throw new Error(`Only the ${CLOCKS} pack moves the clock`);
    const now = Number(q.clock.now);
    if (!Number.isFinite(now)) throw new Error('clock.now is a time, in milliseconds');
    const last = await l.setting<number>(CURSOR);
    await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [CURSOR, JSON.stringify(now)]);
    return { last, zone: (await l.setting<string>('time_zone')) || null };
  }
  if (q.timed !== undefined) {
    if (!Array.isArray(q.timed) || q.timed.some((t) => typeof t !== 'string')) throw new Error('timed is a list of types');
    if (!q.timed.length) return [];
    return (await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and is_open and archived_at is null`, [q.timed])).rows;
  }
  const id = String(q.due_of);
  const { rows } = await l.db.query<{ pos: number }>(`select max(pos)::int as pos from log_fact where stream = 'facts' and id = $1 -- index log_fact_history`, [id]);
  const packs: PackVersion[] = await packVersionsFor(l, await l.entity(id));
  return { version: rows[0]?.pos ?? null, packs };
}
