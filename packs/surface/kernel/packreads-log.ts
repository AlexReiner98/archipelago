// The reads of the log a kernel view needs from src/packreads.ts (task e_exet8395, docs/kernel-packs.md): what a run
// wrote, who last said each field of some items and on whose authority, the runs of a repository or a folder and what
// each touched, the changes held for a person and the questions agents settled for the owner to confirm.
//
// The log's rows carry no row-level security of their own (docs/log.md, "Visibility over the log"): a fact is the
// asker's to read when its item, or its link, is theirs to read now. So every read here joins the projection, which
// the database filters as the asker. Each is bounded by an id, a set of them, a run's time, or a page.

import type { Archipelago } from '../../../src/pelago.ts';
import { openSaid } from '../../../src/seal.ts';
import { livesIn } from './packreads-scope.ts';
import { transientOf } from './root-transient.ts';
import { pageOf, paged, READ_LIMIT, shapes, type Page, type Paged } from './packreads-rows.ts';

/** A fact is the asker's when what it is about is: an item, or a link, they may read now. */
const SEEN = `(exists (select 1 from entity v where v.id = f.id) or exists (select 1 from relation w where w.id = f.id))`;

const noLogin = (l: Archipelago) => {
  if (l.props !== 'props') throw new Error('Anyone with no login reads no log.');
};
const ids = (said: unknown, what: string): string[] => {
  if (!Array.isArray(said) || said.some((id) => typeof id !== 'string')) throw new Error(`${what} is a list of ids`);
  if (said.length > READ_LIMIT) throw new Error(`${what}: ${READ_LIMIT} ids at most`);
  return said;
};

export type Said = { id: string; field: string; op: '+' | '-'; value?: unknown; at: string; changeset: string; actor: string; authority: { of?: string; who?: string } | null; run?: string };

type FactRow = { id: string; field: string; op: '+' | '-'; value: unknown; at: Date; changeset: string; actor: string; authority: { of?: string; who?: string; basis?: unknown } | null; run: string | null };

/** What a fact says, with the change it came in: its values opened, the authority's basis left in the log (it is the change set's words, one key each). */
async function opened(l: Archipelago, rows: FactRow[], values: boolean): Promise<Said[]> {
  const open = values ? await openSaid(l.db, rows) : rows;
  return open.map((r) => ({
    id: r.id,
    field: r.field,
    op: r.op,
    ...(values && r.op === '+' && { value: r.value }),
    at: new Date(r.at).toISOString(),
    changeset: r.changeset,
    actor: r.actor,
    authority: r.authority ? { ...(r.authority.of !== undefined && { of: r.authority.of }), ...(r.authority.who !== undefined && { who: r.authority.who }) } : null,
    ...(r.run && { run: r.run }),
  }));
}

const FACT_COLS = `f.id, f.field, f.op, f.value, le.at, le.id as changeset, le.head->'actor'->>'id' as actor, le.head->'authority' as authority, le.head->>'run' as run`;

/**
 * Every fact a run's changes wrote that the asker may read, in the order the log has them, a page at a time. Read from
 * the run's start on (the log is cut by time), so a run the asker may not read has written nothing they are told of.
 */
export async function factsByRun(l: Archipelago, q: { run: string; values?: boolean; page?: Page }): Promise<Paged<Said>> {
  noLogin(l);
  if (typeof q.run !== 'string') throw new Error('facts.run is the id of a run');
  const page = pageOf(q.page ?? {})!;
  const { rows: run } = await l.db.query<{ start: string }>(`select created_at::text as start from entity where id = $1`, [q.run]);
  if (!run[0]) return { rows: [] };
  const after = page.after ?? ['-1', '-1'];
  const { rows } = await l.db.query<FactRow & { page_key: string; page_id: string }>(
    `select ${FACT_COLS}, f.pos::text as page_key, f.n::text as page_id
     from log_entry le join log_fact f on f.stream = le.stream and f.at = le.at and f.pos = le.pos
     where le.stream = 'facts' and le.at >= $1::timestamptz and le.head->>'run' = $2 and (f.pos, f.n) > ($3::bigint, $4::int) and ${SEEN}
     order by f.pos, f.n limit ${page.size + 1}`,
    [run[0].start, q.run, after[0], after[1]],
  );
  const out = paged(rows, page.size, (r) => r);
  return { rows: await opened(l, out.rows, q.values !== false), ...(out.next && { next: out.next }) };
}

/**
 * For each of some items, who last said each of its fields, when, in which change and on whose authority: the newest
 * fact of each field, by the log's history index. Values are left out unless asked for.
 */
export async function lastSaid(l: Archipelago, q: { ids: string[]; fields?: string[]; values?: boolean }): Promise<Said[]> {
  noLogin(l);
  const of = ids(q.ids, 'said.ids');
  if (!of.length) return [];
  const { rows } = await l.db.query<FactRow>(
    `select distinct on (f.id, f.field) ${FACT_COLS}
     from log_fact f join log_entry le on le.stream = f.stream and le.at = f.at and le.pos = f.pos
     where f.stream = 'facts' and f.id = any($1::text[]) and ($2::text[] is null or f.field = any($2::text[])) and ${SEEN}
     order by f.id, f.field, f.pos desc, f.n desc -- index log_fact_history`,
    [of, q.fields ?? null],
  );
  return opened(l, rows, Boolean(q.values));
}

/** The items each of some runs touched, as its hook kept them (the transient store, under touched:<run>), in the order the runs are given: read past row-level security, since the store is the server's, every run's in one read. */
export async function touchedSets(l: Archipelago, runs: string[]): Promise<string[][]> {
  const keys = runs.map((run) => `touched:${run}`), kept = new Map<string, string[]>();
  for (let i = 0; i < keys.length; i += 100) for (const r of (await transientOf({ caller: 'surface', map: l }, { scan: { keys: keys.slice(i, i + 100) } })) as { key: string; value: string[] }[]) kept.set(r.key, r.value);
  return runs.map((run) => kept.get(`touched:${run}`) ?? []);
}

/**
 * The runs of a repository (those that live in it) or of a folder (started there, or in a folder under it), newest
 * first, a page at a time; each, if asked, with the items it touched that the asker may read (src/touched.ts).
 */
export async function runsOf(l: Archipelago, q: { repo?: string; folder?: string; open?: boolean; touched?: boolean; fields?: string[]; page?: Page }) {
  noLogin(l);
  if ((q.repo === undefined) === (q.folder === undefined)) throw new Error('runs is { repo } or { folder }');
  const { cols, typed } = shapes(l, q.fields);
  const page = pageOf(q.page ?? { size: 50 })!;
  const after = page.after ?? [null, null];
  const kinds = l.registry.family('run');
  const where = `e.type = any($1::text[]) and e.archived_at is null and ($2::boolean is null or e.is_open = $2) and ($3::timestamptz is null or (e.created_at, e.id) < ($3::timestamptz, $4::text))`;
  const { rows } = q.repo !== undefined
    ? await l.db.query<Record<string, unknown> & { type: string; id: string; page_key: string; page_id: string }>(
        `select ${cols('e')}, e.created_at::text as page_key, e.id as page_id from relation r join entity e on e.id = r.from_id
         where r.to_id = $5 and r.type = any($6::text[]) and r.valid_to is null and ${where}
         order by e.created_at desc, e.id desc limit ${page.size + 1}`,
        [kinds, q.open ?? null, after[0], after[1], String(q.repo), livesIn(l)],
      )
    : await l.db.query<Record<string, unknown> & { type: string; id: string; page_key: string; page_id: string }>(
        `select ${cols('e')}, e.created_at::text as page_key, e.id as page_id from entity e
         where ${where} and (e.props->>'cwd' = $5 or starts_with(e.props->>'cwd', $5 || '/') or starts_with(e.props->>'cwd', $5 || '\\'))
         order by e.created_at desc, e.id desc limit ${page.size + 1} -- index entity_type`,
        [kinds, q.open ?? null, after[0], after[1], String(q.folder).replace(/[\\/]+$/, '')],
      );
  const out = paged(rows, page.size, (r) => typed(r as { id: string; type: string; props?: Record<string, unknown>; body?: string }));
  if (!q.touched || !out.rows.length) return out;
  // The set the session's hook kept (the transient store, under touched:<run>) is read past row-level security (it is
  // the server's), through root.transient's own read; what is handed on is only what the asker may read now.
  const sets = await touchedSets(l, out.rows.map((r) => r.id));
  const all = [...new Set(sets.flat())];
  const { rows: seen } = all.length ? await l.db.query<{ id: string }>(`select id from entity where id = any($1::text[]) and archived_at is null`, [all]) : { rows: [] };
  const may = new Set(seen.map((r) => r.id));
  return { ...out, rows: out.rows.map((r, i) => ({ ...r, touched: sets[i].filter((id) => may.has(id)) })) };
}

/** The changes held for a person that the asker may read (their own, or every one for the owner), oldest first, a page at a time. */
export async function heldChanges(l: Archipelago, q: { page?: Page }) {
  noLogin(l);
  const page = pageOf(q.page ?? { size: 50 })!;
  const after = page.after ?? [null, null];
  const { rows } = await l.db.query<{ id: string; ts: Date; actor: string; reason: string; ops: unknown[]; warnings: unknown[]; held_by: unknown; page_key: string; page_id: string }>(
    `select id, ts, actor, reason, ops, warnings, held_by, ts::text as page_key, id as page_id from proposal
     where status = 'pending' and ($1::timestamptz is null or (ts, id) > ($1::timestamptz, $2::text))
     order by ts, id limit ${page.size + 1} -- index proposal_status`,
    [after[0], after[1]],
  );
  return paged(rows, page.size, (r) => ({ ...r, ts: new Date(r.ts).toISOString() }));
}

/** What agents settled that the owner has not confirmed: the questions, and the mark to confirm up to. */
export async function confirmQuestions(l: Archipelago, q: { limit?: number }) {
  noLogin(l);
  const limit = q.limit === undefined ? 40 : Number(q.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > READ_LIMIT) throw new Error(`confirm.limit is a whole number from 1 to ${READ_LIMIT}`);
  return settledUnconfirmed(l, limit);
}

/**
 * Questions agents have settled since the owner last looked, or last answered for them: each decision or hypothesis
 * an agent closed, with what was chosen and on what it rests (what the attention pack puts to the owner: its confirm.ts).
 */
export async function settledUnconfirmed(l: Archipelago, limit: number) {
  // Each mark is in the settings stream; one made before that stream was numbered is an activity entry carried in.
  const { rows: marks } = await l.db.query<{ upto: number | null }>(
    `select max(case when o.stream = 'settings' then (o.facts->0->>3)::int else (o.facts->0->3->'detail'->>'upto')::int end) as upto from log_op o
     where o.seq is not null and o.facts->0->>2 in ('changes.seen', 'questions.confirmed') and o.stream in ('settings', 'activity') -- index log_op_action`,
  );
  const since = marks[0]?.upto ?? 0;
  const { rows } = await l.db.query<{ id: string; type: string; title: string; status: string; outcome: string | null; seq: number; ts: Date; actor: string; changeset: string; authority: { of?: string; basis?: unknown } | null }>(
    // Read from the log: each status an agent set, on its own say or a human's word it reported, that the item still has.
    `select distinct on (e.id) e.id, e.type, e.title, e.status, e.props->>'outcome' as outcome, f.seq::int as seq, le.at as ts, le.head->'actor'->>'id' as actor, le.head->'authority' as authority, le.id as changeset
     from log_fact f join log_entry le on le.stream = f.stream and le.at = f.at and le.pos = f.pos join entity e on e.id = f.id
     where f.stream = 'facts' and f.seq > $1 and f.field = 'status' and f.op = '+' and le.head->'actor'->>'id' not like 'human:%' and coalesce(le.head->'authority'->>'who', '') not like 'human:%'
       and e.type = any($2::text[]) and not e.is_open and e.archived_at is null and f.value = to_jsonb(e.status)
     order by e.id, f.seq desc`,
    [since, [...l.registry.types.values()].filter((t) => t.capabilities.settles !== undefined).map((t) => t.id)], // the types that settle (registry.having)
  );
  // What an agent settled on its own judgment is what the owner has not seen; what it settled on their word they
  // chose themselves, in chat. The first are listed first, and counted apart.
  const own = (q: { authority: { of?: string } | null }) => q.authority?.of !== 'human';
  const newest = rows.sort((a, b) => Number(own(b)) - Number(own(a)) || b.seq - a.seq);
  // The basis is the change set's words, sealed in the log with its key (src/seal.ts): opened only for those listed,
  // since each takes its key from the vault (a map with hundreds settled spent most of the read on the rest).
  const listed = newest.slice(0, limit);
  const bases = await openSaid(l.db, listed.map((r, i) => ({ id: r.changeset, field: 'basis', value: r.authority?.basis, i })));
  for (const b of bases) if (b.value !== undefined) listed[b.i].authority = { ...listed[b.i].authority, basis: b.value };
  const short = (s: string | undefined) => (s && s.length > 240 ? `${s.slice(0, 240)}…` : s);
  return {
    count: newest.length,
    on_agents_judgment: newest.filter(own).length,
    on_owners_word: newest.filter((q) => !own(q)).length,
    upto: newest.reduce((max, q) => Math.max(max, q.seq), since),
    questions: listed.map((q) => ({
      id: q.id,
      title: q.title,
      answer: q.outcome ?? q.status,
      settled: q.ts,
      seq: q.seq,
      by: q.actor,
      on: own(q) ? 'the agent’s own judgment' : 'the owner’s word, as the agent reports it',
      basis: short(q.authority?.basis as string | undefined),
    })),
  };
}
