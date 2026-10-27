// The activity log as it is read: newest first, each event with the title and type of what it is about, filtered by
// when, by whom, about what and from where. What a change set did is read from the log (docs/log.md, section 7): one
// event for each item or link it touched, its action and its before-values found by the history index, its title as
// it was then. What is not a fact (a session's heartbeat, a pack turned on, a proposal decided) is still an event row
// until its own stream holds it. Both are numbered from one sequence, so a cursor (`after`, `before`) runs over both.

import type { Q } from './db.ts';
import { isLink, MOVED } from './replay.ts';
import { openSaid } from './seal.ts';

export type EventQuery = {
  since?: string; before?: number; after?: number; target?: string; actor?: string; origin?: string; action?: string; limit?: number;
  /** Actors whose id matches this pattern (`human:%`). */
  actorLike?: string;
  /** Oldest first, for a cursor read forward. */
  oldest?: boolean;
  /** Only what was written here: an event that arrived in a merged backup is history, not news. */
  news?: boolean;
};

export interface LoggedEvent {
  seq: number;
  ts: Date | string;
  origin: string;
  actor: string;
  action: string;
  target_id: string | null;
  target_title: string | null;
  target_type: string | null;
  changeset: string | null;
  reason: string;
  detail: Record<string, any>;
}

/** The fields of an item that are its columns, as today's events name what changed; any other is one of its props. */
const HEAD = ['title', 'body', 'status', 'owner', 'visibility', 'confidence'];
/** What moves with another field, or is not a change anyone made: left out of what changed. */
const QUIET = ['private_to', 'type', 'source', 'checked'];

/** The actions a change set's events can have. */
export const FACT_ACTIONS = ['entity.create', 'entity.update', 'entity.archive', 'entity.restore', 'entity.merge', 'relation.link', 'relation.unlink', 'type.define'];

type FactRow = { pos: number; id: string; n: number; op: '+' | '-'; field: string; value: any; seq: number; was: ['+' | '-', unknown] | null };
type Group = { seq: number; pos: number; id: string };

const READ_MOST = 500;
/** Entries that seal or compact a day of the compacted streams (src/streams.ts): no item or link moved. */
const SEALS = ['segment.seal', 'segment.compact'];

/**
 * The item or link groups of the fact stream the query asks for: (entry, id), each numbered by its first fact. The
 * entries are picked first, newest (or oldest) first and as many as asked, so a read costs what it answers: facts
 * are numbered in the order they are appended, so a number is a position too.
 */
async function groups(db: Q, input: EventQuery, limit: number): Promise<Group[]> {
  const where = [`e.stream = 'facts'`, `coalesce(e.head->>'action', '') <> all($1::text[])`];
  const params: unknown[] = [[...MOVED, ...SEALS]];
  const add = (sql: string, value: unknown) => where.push(sql.replaceAll('?', `$${params.push(value)}`));
  if (input.since) add(`e.at >= ?::timestamptz`, input.since);
  if (input.actor) add(`e.head->'actor'->>'id' = ?`, input.actor);
  if (input.actorLike) add(`e.head->'actor'->>'id' like ?`, input.actorLike);
  if (input.before) add(`e.pos <= coalesce((select f.pos from log_fact f where f.stream = 'facts' and f.seq < ? order by f.seq desc limit 1), 0)`, input.before);
  if (input.after !== undefined) add(`e.pos >= coalesce((select f.pos from log_fact f where f.stream = 'facts' and f.seq > ? order by f.seq limit 1), 1e18)`, input.after);
  // About an item: what was said of it, of the links from it, and of what was merged into it.
  const about = `(select ?::text union all select l.id from log_fact l where l.field = 'link' and l.value->>1 = ? and left(l.id, 2) = 'r_' union all select m.id from log_fact m where m.field = 'merged_into' and m.value = to_jsonb(?::text) -- index log_fact_link_from, log_fact_merged_into
)`;
  let ids = '';
  if (input.target) {
    add(`e.pos in (select t.pos from log_fact t where t.stream = 'facts' and t.id in ${about} -- index log_fact_history
)`, input.target);
    ids = ` and f.id in ${about.replaceAll('?', `$${params.length}`)}`;
  }
  const having = [`true`];
  if (input.before) having.push(`min(f.seq) < $${params.push(input.before)}`);
  if (input.after !== undefined) having.push(`min(f.seq) > $${params.push(input.after)}`);
  const order = input.oldest ? 'asc' : 'desc';
  const { rows } = await db.query<Group>(
    `with picked as (select e.pos from log_entry e where ${where.join(' and ')} order by e.at ${order}, e.pos ${order} limit $${params.push(limit)})
     select min(f.seq)::int8 as seq, f.pos::int as pos, f.id from log_fact f
     where f.stream = 'facts' and f.pos in (select pos from picked)${ids} group by f.pos, f.id having ${having.join(' and ')}
     order by seq ${order} limit $${params.length}`,
    params,
  );
  return rows.map((r) => ({ ...r, seq: Number(r.seq) }));
}

/** Each group as the event today's tables would have logged for it; a merge is one event, about the item kept. */
async function expand(db: Q, found: Group[]): Promise<Omit<LoggedEvent, 'target_title' | 'target_type'>[]> {
  if (!found.length) return [];
  const { rows: facts } = await db.query<FactRow>(
    `select f.pos::int as pos, f.id, f.n, f.op, f.field, f.value, f.seq::int8 as seq,
       (select jsonb_build_array(p.op, p.value) from log_fact p where p.stream = 'facts' and p.id = f.id and p.field = f.field and p.at <= f.at and p.pos < f.pos order by p.at desc, p.pos desc, p.n desc limit 1) as was
     from log_fact f where f.stream = 'facts' and (f.pos, f.id) in (select * from unnest($1::bigint[], $2::text[])) order by f.pos, f.n`,
    [found.map((g) => g.pos), found.map((g) => g.id)],
  );
  const { rows: heads } = await db.query<{ pos: number; id: string; at: Date; head: Record<string, any>; merged: string[] }>(
    `select e.pos::int as pos, e.id, e.at, e.head, coalesce((select jsonb_agg(m.id) from log_fact m where m.stream = e.stream and m.at = e.at and m.pos = e.pos and m.field = 'merged_into'), '[]') as merged
     from log_entry e where e.stream = 'facts' and e.pos = any($1::bigint[])`,
    [[...new Set(found.map((g) => g.pos))]],
  );
  // What someone said is sealed in the log (src/seal.ts): opened here, before anything reads it.
  const values = await openSaid(db, facts.flatMap((f, i) => [
    { id: f.id, field: f.field, value: f.value, i, was: false },
    ...(f.was ? [{ id: f.id, field: f.field, value: f.was[1], i, was: true }] : []),
  ]));
  for (const v of values) if (v.was) facts[v.i].was![1] = v.value; else facts[v.i].value = v.value;
  const words = await openSaid(db, heads.flatMap((h, i) => [
    { id: h.id, field: 'reason', value: h.head.reason, i, basis: false },
    ...(h.head.authority?.basis !== undefined ? [{ id: h.id, field: 'basis', value: h.head.authority.basis, i, basis: true }] : []),
  ]));
  for (const w of words) if (w.basis) heads[w.i].head.authority = { ...heads[w.i].head.authority, basis: w.value }; else heads[w.i].head.reason = w.value;
  const entries = new Map(heads.map((h) => [h.pos, h]));
  const said = new Map<string, FactRow[]>();
  for (const f of facts) said.set(`${f.pos} ${f.id}`, [...(said.get(`${f.pos} ${f.id}`) ?? []), f]);

  // A title as it was at the entry: the newest said of it by then.
  const wanted = new Map<string, { id: string; pos: number }>();
  const ask = (id: string, pos: number) => wanted.set(`${pos} ${id}`, { id, pos });
  for (const g of found) for (const f of said.get(`${g.pos} ${g.id}`) ?? []) {
    ask(g.id, g.pos);
    if (f.field === 'merged_into') ask(f.value, g.pos);
  }
  const pairs = [...wanted.values()];
  const { rows: titled } = await db.query<{ pos: number; id: string; title: unknown }>(
    `select w.pos::int as pos, w.id, (select p.value from log_fact p where p.stream = 'facts' and p.id = w.id and p.field = 'title' and p.pos <= w.pos order by p.pos desc, p.n desc limit 1) as title
     from unnest($1::bigint[], $2::text[]) w(pos, id)`,
    [pairs.map((p) => p.pos), pairs.map((p) => p.id)],
  );
  const opened = await openSaid(db, titled.map((t) => ({ ...t, field: 'title', value: t.title })));
  const titles = new Map(opened.map((t) => [`${t.pos} ${t.id}`, typeof t.value === 'string' ? t.value : null]));
  const titleAt = (id: string, pos: number) => titles.get(`${pos} ${id}`) ?? null;

  const out: Omit<LoggedEvent, 'target_title' | 'target_type'>[] = [];
  for (const g of found) {
    const e = entries.get(g.pos)!;
    const fs = said.get(`${g.pos} ${g.id}`) ?? [];
    const h = e.head;
    const rule = h.rule as { outcome?: string; by?: string; revised?: boolean } | undefined;
    const extra = {
      ...(rule?.outcome === 'approved' && { approved_by: rule.by, ...(rule.revised && { revised_by: rule.by }) }),
      ...(h.authority && { authority: h.authority }),
      ...(h.action && { action: h.action }),
      ...(h.run && { run: h.run }),
    };
    const event = (action: string, target: string | null, detail: Record<string, unknown>) =>
      out.push({ seq: g.seq, ts: e.at, origin: 'pelago', actor: h.actor?.id, action, target_id: target, changeset: e.id, reason: h.reason ?? '', detail: { ...detail, ...extra } });
    const fact = (field: string) => fs.find((f) => f.field === field);
    const merge = fact('merged_into');
    if (merge) {
      event('entity.merge', merge.value, { title: titleAt(merge.value, g.pos), absorbed: { id: g.id, title: titleAt(g.id, g.pos) } });
      continue;
    }
    // The rest of a merge (links moved or ended, owners and the kept item's fields) is the merge's own event.
    if (e.merged.length) continue;
    const link = isLink(g.id) ? fact('link') : undefined;
    if (isLink(g.id)) {
      if (!link) continue; // a link's own field: no event of its own
      const ends = (link.op === '+' ? link.value : link.was?.[1]) as [string, string, string] | undefined;
      if (!ends || (link.op === '+' && link.was)) continue; // a link moved: a merge's or a retype's
      event(link.op === '+' ? 'relation.link' : 'relation.unlink', ends[1], { relation: g.id, type: ends[0], to: ends[2] });
      continue;
    }
    const def = fact('type_def');
    if (def) {
      event('type.define', null, { type: def.value });
      continue;
    }
    const type = fact('type');
    if (type?.op === '+' && !type.was) {
      event('entity.create', g.id, { type: type.value, title: fact('title')?.value ?? titleAt(g.id, g.pos), status: fact('status')?.value });
      continue;
    }
    const archived = fact('archived');
    if (archived && fs.length === 1) {
      event(archived.op === '+' ? 'entity.archive' : 'entity.restore', g.id, { title: titleAt(g.id, g.pos) });
      continue;
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of fs) {
      if (QUIET.includes(f.field) || f.field === 'archived') continue;
      changes[HEAD.includes(f.field) ? f.field : `props.${f.field}`] = { from: f.was?.[0] === '+' ? f.was[1] : null, to: f.op === '+' ? f.value : null };
    }
    event('entity.update', g.id, { title: titleAt(g.id, g.pos), changes });
  }
  return out;
}

/** What change sets did, as events, through the viewer's rows: an event about something they may not see is left out. */
export async function factEvents(db: Q, input: EventQuery, limit: number): Promise<LoggedEvent[]> {
  if (input.origin && input.origin !== 'pelago') return [];
  if (input.action && !FACT_ACTIONS.includes(input.action)) return [];
  // An action is known only once the facts are read: read further for it, all there is about one item.
  const wide = input.action ? (input.target ? 100_000 : READ_MOST * 4) : limit;
  let rows = await expand(db, await groups(db, input, wide));
  if (input.action) rows = rows.filter((r) => r.action === input.action);
  rows = rows.slice(0, limit);
  const runOf = (r: (typeof rows)[number]) => (typeof r.detail.run === 'string' ? r.detail.run : undefined);
  const targets = [...new Set(rows.flatMap((r) => [r.target_id, runOf(r)].filter((id): id is string => Boolean(id))))];
  const { rows: seen } = await db.query<{ id: string; title: string; type: string }>(`select id, title, type from entity where id = any($1::text[])`, [targets]);
  const known = new Map(seen.map((s) => [s.id, s]));
  // The session a change came from is named as it is everywhere: by its title.
  const session = (r: (typeof rows)[number]) => { const run = runOf(r); return run && known.has(run) ? { detail: { ...r.detail, run_name: known.get(run)!.title } } : {}; };
  return rows.filter((r) => !r.target_id || known.has(r.target_id)).map((r) => ({ ...r, ...session(r), target_title: r.target_id ? known.get(r.target_id)!.title : null, target_type: r.target_id ? known.get(r.target_id)!.type : null }));
}

/** True of an event that was written here, false of one that arrived in a merged backup: those are history, not news. */
export const notImported = (ev: string) =>
  `not exists (select 1 from event imp where imp.action = 'workspace.import' and ${ev}.seq between (imp.detail->>'first_seq')::bigint and (imp.detail->>'last_seq')::bigint) -- index event_imports
`;

/** Events that are not facts, from the event table, under the same filters. */
async function rowEvents(db: Q, input: EventQuery, limit: number): Promise<LoggedEvent[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => where.push(sql.replace('?', `$${params.push(value)}`));
  if (input.since) add(`ev.ts >= ?::timestamptz`, input.since);
  if (input.before) add(`ev.seq < ?`, input.before);
  if (input.after !== undefined) add(`ev.seq > ?`, input.after);
  if (input.target) add(`ev.target_id = ?`, input.target);
  if (input.actor) add(`ev.actor = ?`, input.actor);
  if (input.origin) add(`ev.origin = ?`, input.origin);
  if (input.action) add(`ev.action = ?`, input.action);
  if (input.actorLike) add(`ev.actor like ?`, input.actorLike);
  if (input.news) where.push(notImported('ev'));
  const { rows } = await db.query<LoggedEvent>(
    `select ev.seq::int8 as seq, ev.ts, ev.origin, ev.actor, ev.action, ev.target_id, e.title as target_title, e.type as target_type, ev.changeset, ev.reason, ev.detail
     from event ev left join entity e on e.id = ev.target_id
     ${where.length ? 'where ' + where.join(' and ') : ''} order by ev.seq ${input.oldest ? 'asc' : 'desc'} limit $${params.push(limit)}`,
    params,
  );
  return rows.map((r) => ({ ...r, seq: Number(r.seq) }));
}

/** The activity log: what change sets did and the events that are not facts, in one order. */
export async function readEvents(db: Q, input: EventQuery): Promise<LoggedEvent[]> {
  const limit = Math.min(input.limit ?? 50, READ_MOST);
  const [facts, rows] = await Promise.all([factEvents(db, input, limit), rowEvents(db, input, limit)]);
  const order = input.oldest ? 1 : -1;
  return [...facts, ...rows].sort((a, b) => order * (a.seq - b.seq)).slice(0, limit);
}

/** The newest number either kind of event has: a cursor's start. */
export async function lastSeq(db: Q): Promise<number> {
  const { rows } = await db.query<{ seq: string }>(`select greatest((select coalesce(max(seq), 0) from event), (select coalesce(max(seq), 0) from log_fact)) as seq -- index log_fact_seq`);
  return Number(rows[0].seq);
}

/**
 * Step 19. Each fact numbered from the event table's sequence, so the activity log is in one order across both;
 * found by that number, by what a link starts from and what an item was merged into, and its entries by their time. The number is not hashed: it is
 * where the row sits in this database, not part of what was said.
 */
export const ACTIVITY = `
alter table log_fact add column if not exists seq bigint default nextval('event_seq_seq');
create index if not exists log_fact_seq on log_fact(seq);
create index if not exists log_fact_link_from on log_fact((value->>1)) where field = 'link';
create index if not exists log_fact_merged_into on log_fact(value) where field = 'merged_into';
create index if not exists log_entry_at on log_entry(at);
`;
