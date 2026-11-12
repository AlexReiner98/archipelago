// What the query pack reads of the reads API (packs/query): the flat lens's seeds, walk and rows (./packreads-flat.ts),
// and what the standing views read that are not lenses: what changed since a moment, the sessions open and the last
// that ended, the unread notifications, the items placed in a window of time, and the zone days are counted in. Each
// is bounded by the ids it is given, a limit, or an index it names, and answered as the asker under row-level security,
// as every read of packreads.ts is. The SQL is the modules' own, moved as it was.

import type { Archipelago, Entity } from '../../../src/pelago.ts';
import { factEvents, readEvents } from '../../log/kernel/eventlog.ts';
import { doneCounts } from '../../log/kernel/activity.ts';
import { flatRead, type FlatRead } from './packreads-flat.ts';
import { NAME, shapes } from './packreads-rows.ts';

export type QueryRead = FlatRead & {
  /** What changed since a moment: how many events of each kind (counted over at most `counted` change sets' facts), and the newest of them. */
  changed?: { since: string; limit?: number; counted: number };
  /** The sessions open, newest first, with the links of these types from each (and what each links to), and the ten that ended last. */
  open_runs?: { links: string[] };
  /** The unread notifications for the human, newest first, each with what it is about: a hundred at most. */
  notifications?: true;
  /** Items of some types not archived, open or changed since a moment, the newest changed first: each as a read gives it back (row) and as it is kept (at). */
  placed_rows?: { types: string[]; since: string; limit: number };
  /** The zone the workspace counts its days in, as its setting names it, or none. */
  time_zone?: true;
};

const list = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`${what} is a list of names`);
  return v as string[];
};

/** The answer to one of these reads, or undefined when the read is none of them. */
export async function queryRead(l: Archipelago, q: QueryRead): Promise<unknown> {
  const flat = await flatRead(l, q);
  if (flat !== undefined) return flat;
  if (q.changed !== undefined) {
    const { since, limit, counted } = q.changed;
    if (typeof since !== 'string' || Number.isNaN(Date.parse(since))) throw new Error('changed.since is an ISO date or date-time');
    // The counts are of everything since; the events are the newest of them, few enough to read.
    const events = await readEvents(l.db, { since, limit: limit ?? 50 });
    const counts = await doneCounts(l.db, since);
    for (const ev of await factEvents(l.db, { since }, Math.min(Number(counted) || 0, 20_000))) counts.set(ev.action, (counts.get(ev.action) ?? 0) + 1);
    return { events, counts: Object.fromEntries(counts) };
  }
  if (q.open_runs !== undefined) {
    const runs = l.registry.family('run');
    const { rows: open } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and is_open and archived_at is null order by created_at desc`, [runs]);
    const { rows: links } = await l.db.query<{ run: string; type: string; id: string; title: string; entity_type: string }>(
      `select r.from_id as run, r.type, e.id, e.title, e.type as entity_type from relation r join entity e on e.id = r.to_id
       where r.from_id = any($1::text[]) and r.valid_to is null and r.type = any($2::text[])`,
      [open.map((r) => r.id), list(q.open_runs.links, 'open_runs.links')],
    );
    const { rows: ended } = await l.db.query(
      `select id, title, status, updated_at from entity where type = any($1::text[]) and not is_open and archived_at is null order by updated_at desc limit 10`,
      [runs],
    );
    return { open, links, ended };
  }
  if (q.notifications) {
    const { rows } = await l.db.query(
      `select n.id, n.title, n.body, n.props->>'level' as level, n.props->>'from' as from, n.created_at,
              a.id as about_id, a.title as about_title
       from entity n
       left join relation r on r.from_id = n.id and r.type = 'about' and r.valid_to is null
       left join entity a on a.id = r.to_id
       where n.type = any($1::text[]) and n.is_open and n.archived_at is null
       order by n.created_at desc limit 100`,
      [l.registry.family('notification')],
    );
    return rows;
  }
  if (q.placed_rows !== undefined) {
    const { types, since, limit } = q.placed_rows;
    if (typeof since !== 'string') throw new Error("placed_rows.since is a moment, as a lens's time axis says one");
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new Error('placed_rows.limit is a whole number from 1 to 2000');
    const fields = (q as { fields?: string[] }).fields;
    if (fields && (!Array.isArray(fields) || fields.some((f) => !NAME.test(f)))) throw new Error('fields is a list of field names');
    const { cols, typed, family } = shapes(l, fields);
    const { rows } = await l.db.query<Entity>(
      `select ${cols('e')} from entity e where e.type = any($1::text[]) and e.archived_at is null and (e.is_open or e.updated_at >= $2::timestamptz) order by e.updated_at desc limit ${limit} -- index entity_type`,
      [family(list(types, 'placed_rows.types')) ?? [], since],
    );
    return rows.map((e) => ({ row: typed(e), at: e }));
  }
  if (q.time_zone) return (await l.setting<string>('time_zone')) || null;
  return undefined;
}
