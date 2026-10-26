// The log read forward by a page that holds part of the map (ui/replica.js): the facts after a position, on the
// items and links it holds, the links made touching them, and what such a link brought that was made with it. What
// the viewer may see is what today's tables show them (row-level security): facts on anything else are left out,
// and what they held and can no longer see is named as gone. Sealed values are opened for the viewer. The page
// projects the facts itself, with the projector the server runs (src/project.ts), so a change reaches it without a
// lens read.

import type { Q } from './db.ts';
import type { Fact } from './log.ts';
import { MOVED } from './project.ts';
import { openSaid } from './seal.ts';

/** Entries read in one call at most: a page further behind asks again from where the answer stops (`more`). */
const ENTRIES = 500;
/** Ids a page may hold and name in one call. */
export const HELD_MOST = 5000;

export interface FactsAfter {
  /** The last entry read: the next read asks from here. */
  pos: number;
  /** The entries in order that said something of what is held, each with only those facts. */
  entries: { pos: number; at: string; moved?: true; facts: Fact[] }[];
  /** What is held and was named in these entries that the viewer cannot see now: forgotten, or made private to someone else. */
  gone: string[];
  /** How many items were made in these entries that the viewer may see, held or not: a list may hold a new one. */
  made: number;
  /** The read stopped short of the stream's end: ask again from `pos`. */
  more?: true;
}

/** The fact stream's last position, where a page that has read nothing yet starts. */
export async function headPos(db: Q): Promise<number> {
  const { rows } = await db.query<{ pos: number | null }>(`select max(pos)::int as pos from log_entry where stream = 'facts' -- index log_entry_pos`);
  return rows[0].pos ?? 0;
}

type Said = { pos: number; n: number; op: '+' | '-'; id: string; field: string; value: unknown; meta: Record<string, unknown> | null };

/** The facts after `after` on the ids held, as the viewer may see them. A read that names nothing is refused: it would read the whole log. */
export async function factsAfter(db: Q, input: { after: number; ids: string[]; limit?: number }): Promise<FactsAfter> {
  const ids = [...new Set(input.ids ?? [])];
  if (!ids.length) throw new Error('A read of the log names the ids it holds (ids): one that names none would read all of it.');
  if (ids.length > HELD_MOST) throw new Error(`A read of the log names ${HELD_MOST} ids at most; this one names ${ids.length}.`);
  const limit = Math.min(input.limit ?? ENTRIES, ENTRIES);
  // The entries after the position, bounded by its time too, so the partitions before it are not read.
  const { rows: window } = await db.query<{ pos: number; at: Date; action: string | null }>(
    `select pos::int as pos, at, head->>'action' as action from log_entry where stream = 'facts' and pos > $1
       and at >= coalesce((select at from log_entry where stream = 'facts' and pos = $1), '-infinity') order by pos limit $2`,
    [input.after, limit + 1],
  );
  const more = window.length > limit;
  if (more) window.pop();
  if (!window.length) return { pos: input.after, entries: [], gone: [], made: 0 };
  const last = window.at(-1)!;
  // The facts of those entries on what is held; on each link made touching it; and on what such a link reaches that
  // was made in the same entries (an agent's new task, linked to a project on the page).
  const { rows } = await db.query<Said>(
    `with w as (select pos::int as pos, n, op, id, field, value, meta from log_fact
                where stream = 'facts' and pos > $1 and pos <= $2 and at >= $3 and at <= $4),
          links as (select distinct id from w where field = 'link' and op = '+' and (value->>1 = any($5::text[]) or value->>2 = any($5::text[]))),
          ends as (select w.value->>1 as id from w join links using (id) where w.field = 'link' and w.op = '+'
                   union select w.value->>2 from w join links using (id) where w.field = 'link' and w.op = '+'),
          made as (select distinct w.id from w join ends using (id) where w.field = 'type' and w.op = '+'),
          scope as (select unnest($5::text[]) as id union select id from links union select id from made)
     select w.* from w join scope using (id) order by w.pos, w.n`,
    [input.after, last.pos, new Date(window[0].at).toISOString(), new Date(last.at).toISOString(), ids],
  );
  // What the viewer may see now, as today's tables show them (row-level security), of what these facts name; and
  // how many items made in these entries they may see.
  const named = [...new Set(rows.map((r) => r.id))];
  const { rows: seen } = await db.query<{ id: string }>(`select id from entity where id = any($1::text[]) union all select id from relation where id = any($1::text[])`, [named]);
  const visible = new Set(seen.map((r) => r.id));
  const { rows: born } = await db.query<{ n: number }>(
    `select count(*)::int as n from entity where id in (select id from log_fact where stream = 'facts' and pos > $1 and pos <= $2 and at >= $3 and at <= $4 and field = 'type' and op = '+' and left(id, 2) = 'e_')`,
    [input.after, last.pos, new Date(window[0].at).toISOString(), new Date(last.at).toISOString()],
  );
  const held = new Set(ids);
  const opened = await openSaid(db, rows.filter((r) => visible.has(r.id)));
  const by = new Map<number, Fact[]>();
  for (const r of opened) {
    const fact = (r.op === '-' ? ['-', r.id, r.field] : r.meta ? ['+', r.id, r.field, r.value, r.meta] : ['+', r.id, r.field, r.value]) as Fact;
    by.set(r.pos, [...(by.get(r.pos) ?? []), fact]);
  }
  const entries = window
    .filter((e) => by.has(e.pos))
    .map((e) => ({ pos: e.pos, at: new Date(e.at).toISOString(), ...(MOVED.includes(e.action ?? '') && { moved: true as const }), facts: by.get(e.pos)! }));
  return { pos: last.pos, entries, gone: named.filter((id) => !visible.has(id) && held.has(id)), made: born[0].n, ...(more && { more: true as const }) };
}

/**
 * What else moved on what is held, outside the fact stream: the events still kept as rows (a session's heartbeat, a
 * pack turned on), after an event number, read through the viewer's own rows. The page draws again for them; there
 * are no facts in them to project.
 */
export async function eventsAfter(db: Q, input: { seq?: number; ids: string[] }): Promise<{ seq: number; ids: string[] }> {
  const { rows: top } = await db.query<{ seq: number }>(`select coalesce((select seq from event order by seq desc limit 1), 0)::int as seq`);
  if (input.seq === undefined || !input.ids.length) return { seq: top[0].seq, ids: [] };
  const { rows } = await db.query<{ id: string }>(`select distinct target_id as id from event where seq > $1 and target_id = any($2::text[])`, [input.seq, input.ids]);
  return { seq: top[0].seq, ids: rows.map((r) => r.id) };
}
