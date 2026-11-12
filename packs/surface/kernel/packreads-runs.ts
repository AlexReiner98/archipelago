// The reads the runs pack needs of the reads API (decision e_w4bmpnx3): what sessions worked on and where, their states,
// turns and spans, what they spent, and the places a session is in. Each is bounded by the ids it is given, a time in
// the log or the stream, a limit, or an index it names, and answered as the asker under row-level security, as every
// read of packreads.ts is. The SQL is the modules' own, moved as it was (packs/runs/kernel).

import type { Archipelago, Entity } from '../../write/kernel/pelago.ts';
import { openOps } from '../../seal/kernel/opseal.ts';
import { isSealed } from '../../seal/kernel/seal.ts';
import type { Light, OpFact } from '../../log/kernel/streams.ts';
import { searchMap, type SearchInput } from './search.ts';
import { touchedSets } from './packreads-log.ts';

export type RunsRead = {
  /** A run by its id, or by the session id its surface named it with (the open one first, then the newest); open: only an open one. */
  run_of?: { key: string; open?: boolean };
  /** The runs heard from since a moment, newest first, at most 300. */
  runs_lately?: { since: string };
  /** The runs made since a moment, with their fields: what each spent. */
  runs_made?: { types: string[]; since: string };
  /** Of some runs: what their state is worked out from (status, times, story, last_seen, busy). */
  run_rows?: string[];
  /** Of some runs: what each works on now, newest first, with since when that waits on open work. */
  run_works?: { ids: string[]; works_on: string[]; depends_on: string[] };
  /** Of some runs: every works_on link they had, open or closed, with the item's title and type. */
  run_links?: { ids: string[]; works_on: string[] };
  /** Of some runs: every works_on link they had, open or closed, in the order taken up. */
  run_tasks?: string[];
  /** Of some runs: what each did to its own record, when (the signs of work of one recorded before its stretches were kept). */
  run_signs?: string[];
  /** Of some runs (not archived): title and whether open. */
  run_open?: string[];
  /** Of some items: title and the name it goes by. */
  run_names?: string[];
  /** The events of some runs kept on the sessions stream since a moment, each run's in order. */
  run_events?: { runs: string[]; since: string };
  /** The events kept on the sessions stream in a range, by run, at most `most` entries (the newest), and whether there were more. */
  events_in?: { since: string; until: string; most: number };
  /** What some runs worked on since a moment: what they changed (the log keeps each change's run), were set to work on, or touched. */
  worked_on?: { runs: string[]; since: string };
  /** Some items and what is one step from them along part_of, either way. */
  part_around?: string[];
  /** Of some items, not archived: what the frontier weighs (type, title, status, open, fields). */
  run_items?: string[];
  /** Of some items, those that hold another of them by part_of. */
  hubs_among?: string[];
  /** The live places of some types, the oldest first. */
  places_of?: string[];
  /** What the map holds that matches some text (surface's search). */
  search_map?: SearchInput;
  /** What is one step from some items along some kinds of link, either way. */
  steps_near?: { ids: string[]; types: string[] };
  /** Of some items, those of some types, not archived, the newest first. */
  settling?: { ids: string[]; types: string[] };
};

type Row = { stream: Light['stream']; pos: number; at: Date; head: Omit<Light, 'stream' | 'pos' | 'at' | 'facts'>; facts: OpFact[] };
type Event = { at: string; kind: string; [field: string]: unknown };

/** The field each fact of an event is kept under on its run (the sessions pack's EVENT_FIELD). */
const EVENT_FIELD = 'event';

const list = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.some((id) => typeof id !== 'string')) throw new Error(`${what} is a list of ids`);
  return v as string[];
};

/** Entries of the sessions stream, opened: each event fact of the runs it is about, as kept. */
async function opened(l: Archipelago, rows: Row[]): Promise<[string, Event][]> {
  const entries = await openOps(l.db, rows.map((r): Light => ({ ...r.head, stream: r.stream, pos: r.pos, at: new Date(r.at).toISOString(), facts: r.facts })));
  // An event whose key is gone (its run forgotten) reads as a digest, and is no event any more.
  return entries.flatMap((e) => e.facts.filter((f) => f[0] === '+' && f[2] === EVENT_FIELD && !isSealed(f[3]) && typeof (f[3] as Event)?.kind === 'string').map((f): [string, Event] => [f[1], f[3] as Event]));
}

/** The answer to one of these reads, or undefined when the read is none of them. */
export async function runsRead(l: Archipelago, q: RunsRead): Promise<unknown> {
  if (q.run_of !== undefined) {
    const key = String(q.run_of.key);
    const { rows: byId } = await l.db.query<Entity>(`select * from entity where id = $1`, [key]);
    if (byId[0] && l.registry.isA(byId[0].type, 'run')) return byId[0];
    const { rows } = await l.db.query<Entity>(
      `select * from entity where type = any($1::text[]) and props->>'session_id' = $2 and archived_at is null
         and ($3::boolean is false or is_open) order by is_open desc, created_at desc limit 1`,
      [l.registry.family('run'), key, q.run_of.open === true],
    );
    return rows[0] ?? null;
  }
  if (q.runs_lately !== undefined) {
    const { rows } = await l.db.query<Entity>(`select * from entity where type = 'run' and archived_at is null and updated_at > $1 order by updated_at desc limit 300 -- index entity_type`, [new Date(q.runs_lately.since)]);
    return rows;
  }
  if (q.runs_made !== undefined) {
    const { rows } = await l.db.query<Entity>(`select id, title, props, created_at from entity where type = any($1::text[]) and archived_at is null and created_at >= $2::timestamptz`, [list(q.runs_made.types, 'runs_made.types'), q.runs_made.since]);
    return rows;
  }
  if (q.run_rows !== undefined) {
    const { rows } = await l.db.query(
      `select id, status, is_open, created_at, updated_at, props->'story' as story, props->>'last_seen' as last_seen, (props->>'busy')::boolean as busy from entity where id = any($1::text[])`,
      [list(q.run_rows, 'run_rows')],
    );
    return rows;
  }
  if (q.run_works !== undefined) {
    const { rows } = await l.db.query(
      `select r.from_id as run, e.title,
              (select max(d.valid_from) from relation d join entity t on t.id = d.to_id
                where d.from_id = e.id and d.valid_to is null and d.type = any($3::text[]) and t.is_open) as since
       from relation r join entity e on e.id = r.to_id
       where r.from_id = any($1::text[]) and r.valid_to is null and r.type = any($2::text[]) order by r.valid_from desc`,
      [list(q.run_works.ids, 'run_works.ids'), list(q.run_works.works_on, 'run_works.works_on'), list(q.run_works.depends_on, 'run_works.depends_on')],
    );
    return rows;
  }
  if (q.run_links !== undefined) {
    const { rows } = await l.db.query(
      `select r.from_id as run, r.to_id as item, e.title, e.type, r.valid_from, r.valid_to from relation r join entity e on e.id = r.to_id
       where r.from_id = any($1::text[]) and r.type = any($2::text[])`,
      [list(q.run_links.ids, 'run_links.ids'), list(q.run_links.works_on, 'run_links.works_on')],
    );
    return rows;
  }
  if (q.run_tasks !== undefined) {
    const { rows } = await l.db.query(`select from_id as run, to_id as task, valid_from, valid_to from relation where type = 'works_on' and from_id = any($1::text[]) order by valid_from`, [list(q.run_tasks, 'run_tasks')]);
    return rows;
  }
  if (q.run_signs !== undefined) {
    const { rows } = await l.db.query(`select o.facts->0->>1 as run, o.at as ts from log_op o where o.seq = any(array(select pelago_op_about($1::text[]))) -- index log_op_about

     union all select f.id, e.at from log_fact f join log_entry e on e.stream = f.stream and e.at = f.at and e.pos = f.pos where f.stream = 'facts' and f.id = any($1::text[])`, [list(q.run_signs, 'run_signs')]);
    return rows;
  }
  if (q.run_open !== undefined) {
    const { rows } = await l.db.query(`select id, title, is_open from entity where id = any($1::text[]) and archived_at is null`, [list(q.run_open, 'run_open')]);
    return rows;
  }
  if (q.run_names !== undefined) {
    const { rows } = await l.db.query(`select id, title, props->>'name' as name from entity where id = any($1::text[])`, [list(q.run_names, 'run_names')]);
    return rows;
  }
  if (q.run_events !== undefined) {
    const runs = list(q.run_events.runs, 'run_events.runs');
    const out: Record<string, Event[]> = Object.fromEntries(runs.map((r) => [r, []]));
    if (!runs.length) return out;
    // One run is read by its facts; many, by each entry's facts matched by run, not tested against every run in turn.
    const { rows } = runs.length === 1
      ? await l.db.query<Row>(`select stream, pos::int as pos, at, head, facts from log_op where stream = 'sessions' and at >= $1 and facts @> $2::jsonb order by at, pos`, [new Date(q.run_events.since).toISOString(), JSON.stringify([['+', runs[0], EVENT_FIELD]])])
      : await l.db.query<Row>(
          `select stream, pos::int as pos, at, head, facts from log_op where stream = 'sessions' and at >= $1
           and exists (select 1 from jsonb_array_elements(facts) f where f->>0 = '+' and f->>2 = $3 and f->>1 = any($2::text[])) order by at, pos`,
          [new Date(q.run_events.since).toISOString(), runs, EVENT_FIELD],
        );
    for (const [run, event] of await opened(l, rows)) out[run]?.push(event);
    // Stable: what came at the same time stays in the order it was sent.
    for (const events of Object.values(out)) events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return out;
  }
  if (q.events_in !== undefined) {
    const most = Math.max(1, Math.floor(Number(q.events_in.most)) || 1);
    const { rows } = await l.db.query<Row>(
      `select stream, pos::int as pos, at, head, facts from log_op where stream = 'sessions' and at >= $1 and at < $2
       order by at desc, pos desc limit ${most + 1}`,
      [new Date(q.events_in.since).toISOString(), new Date(new Date(q.events_in.until).getTime() + 60_000).toISOString()],
    );
    const mine = rows.slice(0, most).filter((r) => r.facts.some((f) => f[0] === '+' && f[2] === EVENT_FIELD)).reverse();
    const [since, until] = [Date.parse(q.events_in.since), Date.parse(q.events_in.until)];
    const runs: Record<string, Event[]> = {};
    for (const [run, event] of await opened(l, mine)) {
      const t = Date.parse(event.at);
      if (t < since || t > until) continue;
      (runs[run] ??= []).push(event);
    }
    for (const events of Object.values(runs)) events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return { runs, more: rows.length > most };
  }
  if (q.worked_on !== undefined) {
    const ids = list(q.worked_on.runs, 'worked_on.runs');
    if (!ids.length) return [];
    // Three reads that wait on nothing of each other, asked together.
    const [{ rows: changed }, { rows: on }, touched] = await Promise.all([
      l.db.query<{ id: string }>(
        `select distinct f.id from log_entry e join log_fact f on f.stream = e.stream and f.pos = e.pos and f.at = e.at
         where e.stream = 'facts' and e.at > $2 and e.head->>'run' = any($1::text[]) and f.id like 'e\\_%' -- index log_entry_at`,
        [ids, new Date(q.worked_on.since)],
      ),
      l.db.query<{ id: string }>(`select to_id as id from relation where type = 'works_on' and from_id = any($1::text[])`, [ids]),
      touchedSets(l, ids),
    ]);
    return [...new Set([...changed.map((r) => r.id), ...on.map((r) => r.id), ...touched.flat()])];
  }
  if (q.part_around !== undefined) {
    const ids = list(q.part_around, 'part_around');
    if (!ids.length) return [];
    const { rows } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null and (from_id = any($1::text[]) or to_id = any($1::text[]))`, [ids]);
    return [...new Set([...ids, ...rows.flatMap((r) => [r.from_id, r.to_id])])];
  }
  if (q.run_items !== undefined) {
    const { rows } = await l.db.query(`select id, type, title, status, is_open, props from entity where id = any($1::text[]) and archived_at is null`, [list(q.run_items, 'run_items')]);
    return rows;
  }
  if (q.hubs_among !== undefined) {
    const { rows } = await l.db.query<{ id: string }>(`select distinct to_id as id from relation where type = 'part_of' and valid_to is null and to_id = any($1::text[]) and from_id = any($1::text[])`, [list(q.hubs_among, 'hubs_among')]);
    return rows.map((r) => r.id);
  }
  if (q.places_of !== undefined) {
    const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null order by created_at, id`, [list(q.places_of, 'places_of')]);
    return rows;
  }
  if (q.search_map !== undefined) return searchMap(l, q.search_map);
  if (q.steps_near !== undefined) {
    const { rows } = await l.db.query<{ id: string }>(
      `select case when from_id = any($1::text[]) then to_id else from_id end as id from relation
       where valid_to is null and type = any($2::text[]) and (from_id = any($1::text[]) or to_id = any($1::text[]))`,
      [list(q.steps_near.ids, 'steps_near.ids'), list(q.steps_near.types, 'steps_near.types')],
    );
    return rows.map((r) => r.id);
  }
  if (q.settling !== undefined) {
    const { rows } = await l.db.query(
      `select id, type, title, status, is_open, props, updated_at from entity where id = any($1::text[]) and type = any($2::text[]) and archived_at is null order by updated_at desc`,
      [list(q.settling.ids, 'settling.ids'), list(q.settling.types, 'settling.types')],
    );
    return rows;
  }
  return undefined;
}
