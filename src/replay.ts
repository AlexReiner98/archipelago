// The projector: the log read into the tables every page reads (docs/log.md, section 7). Each fact sets one column
// or one declared field of an item or a link, the times come from the entry, and a held change's record and the
// entry that decides it make its row of the review queue. The write path plans a change into facts and projects
// them as it goes, in the append's transaction, so a page never sees the log ahead of its projections; a rebuild
// projects a whole stream into empty tables the same way (`rebuild`), and the two must agree row for row.

import type { Entry, Fact } from './log.ts';
import type { Q } from './db.ts';
import { itemStep, isLink, linkStep, MOVED, runs, type Kinds } from './project.ts';
import { joined, regather } from './closure.ts';
import { mentioned } from './mentions.ts';

// The pure part, one file the page runs too (src/project.ts): kept importable from here, where it always was.
export { isLink, kindsOf, MOVED, type Kinds } from './project.ts';

type Props = Record<string, unknown>;

/** A forgotten item's rows leave today's tables, its links with them, and what named it as owner or source names nothing. */
export const FORGET_ROWS = [`update entity set owner = null where owner = $1`, `update entity set source_id = null where source_id = $1`, `update relation set source_id = null where source_id = $1`,
  `delete from relation where from_id = $1 or to_id = $1`, `delete from entity where id = $1`,
  // What was inside it keeps only the ancestors its links still reach (src/closure.ts), and it leaves the closure.
  `with recursive below(id) as (select descendant from part_closure where ancestor = $1),
   up(d, a) as (select r.from_id, r.to_id from relation r join below b on b.id = r.from_id where r.valid_to is null and r.type = 'part_of'
     union select up.d, r.to_id from up join relation r on r.from_id = up.a where r.valid_to is null and r.type = 'part_of')
   delete from part_closure c using below b where c.descendant = b.id and not exists (select 1 from up where up.d = c.descendant and up.a = c.ancestor)`,
  `delete from part_closure where ancestor = $1 or descendant = $1`, `delete from mention where from_id = $1 or to_id = $1`];

/** One run of facts on an item, folded (src/project.ts) and written into entity. */
async function item(tx: Q, reg: Kinds, at: string, moved: boolean, id: string, run: Fact[]) {
  const { rows } = await tx.query<{ type: string; status: string }>(`select type, status from entity where id = $1`, [id]);
  const step = itemStep(reg, at, id, run, rows[0]);
  if ('skip' in step) return;
  if ('forget' in step) {
    for (const sql of FORGET_ROWS) await tx.query(sql, [id]);
    return;
  }
  if ('insert' in step) {
    const row = step.insert;
    await tx.query(
      `insert into entity (id, type, kind, title, body, status, visibility, private_to, owner, confidence, source_id, is_open, props, created_at, updated_at, archived_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $14, $15)`,
      [id, row.type, row.kind, row.title, row.body, row.status, row.visibility, row.private_to, row.owner, row.confidence, row.source_id, row.is_open, JSON.stringify(row.props), at, row.archived_at],
    );
    await mentioned(tx, id);
    return;
  }
  const params: unknown[] = [id, at, step.is_open, JSON.stringify(step.props), step.unset, moved];
  const cols = Object.entries(step.update).map(([column, value]) => `${column} = $${params.push(value)}`);
  if (step.archived !== undefined) cols.push(`archived_at = ${step.archived ? '$2' : 'null'}`);
  await tx.query(
    `update entity set ${[...cols, ''].join(', ')}is_open = $3, props = (props || $4::jsonb) - $5::text[], updated_at = case when $6 then updated_at else $2 end where id = $1`,
    params,
  );
  if (step.mentions) await mentioned(tx, id);
}

/** One run of facts on a link, folded (src/project.ts) and written into relation, with what is inside what after it. */
async function link(tx: Q, reg: Kinds, at: string, id: string, run: Fact[]) {
  const { rows } = await tx.query<{ id: string; type: string; from_id: string }>(`select id, type, from_id from relation where id = $1`, [id]);
  const was = rows[0];
  const step = linkStep(at, id, run, Boolean(was));
  if ('skip' in step) return;
  const parts = reg.relationFamily('part_of');
  if ('insert' in step) {
    const row = step.insert;
    await tx.query(
      `insert into relation (id, type, from_id, to_id, props, confidence, source_id, valid_from, valid_to) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
      [id, row.type, row.from_id, row.to_id, JSON.stringify(row.props), row.confidence, row.source_id, at, row.valid_to],
    );
    // What is inside what, all the way down, follows a part_of link the moment it is made.
    if (parts.includes(row.type) && row.valid_to === null) await joined(tx, row.from_id, row.to_id);
    return;
  }
  const params: unknown[] = [id, JSON.stringify(step.props), step.unset];
  const cols = Object.entries(step.update).map(([column, value]) => `${column} = $${params.push(value)}`);
  await tx.query(`update relation set ${[...cols, ''].join(', ')}props = (props || $2::jsonb) - $3::text[] where id = $1`, params);
  // A part_of link ended, moved or retyped: what was below it, and what is below it now, find their ancestors again.
  if (step.moved && (parts.includes(was.type) || parts.includes(step.update.type as string))) await regather(tx, [...new Set([was.from_id, (step.update.from_id as string | undefined) ?? was.from_id])], parts);
}

/**
 * Facts said at a moment, projected into entity and relation in order. moved: a pack moved a type or a kind, and
 * the items' time stays. The write path calls it op by op, so each op reads what the ones before it did.
 */
export async function projectFacts(tx: Q, reg: Kinds, at: string, facts: Fact[], moved = false): Promise<void> {
  for (const run of runs(facts)) {
    const id = run[0][1];
    // A link's id says it is one: an item may have a field called link of its own.
    if (isLink(id)) await link(tx, reg, at, id, run);
    else await item(tx, reg, at, moved, id, run);
  }
}

const digest = (v: unknown) => typeof v === 'object' && v !== null && '$h' in v;
const FORGOTTEN = 'Forgotten with what it touched';

/** The review queue: a held change's record makes its row, and the entry that decides it says what became of it. */
export async function projectDecision(tx: Q, e: Entry): Promise<void> {
  if (e.stream === 'pending') {
    // Read back from the log after a forget, what the held change said is a digest: its row is what the forget left of it.
    const gone = digest(e.ops);
    await tx.query(
      `insert into proposal (id, ts, actor, reason, source, ops, warnings, private_to, held_by, status, note) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11)`,
      [e.id, e.at, e.actor.id, digest(e.reason) ? '' : e.reason, gone || e.source == null ? null : JSON.stringify(e.source), JSON.stringify(gone ? [] : (e.ops ?? [])), JSON.stringify(gone ? [] : (e.warnings ?? [])),
        (e.private_to as string | null) ?? null, e.held_by == null ? null : JSON.stringify(e.held_by), gone ? 'superseded' : 'pending', gone ? FORGOTTEN : null],
    );
    return;
  }
  const rule = e.rule as { outcome: string; proposal?: string; by?: string; note?: string } | undefined;
  if (!rule?.proposal) return;
  const status = rule.outcome;
  const note = status === 'rejected' ? e.reason : status === 'superseded' ? `Already so since ${rule.by}` : (rule.note ?? null);
  await tx.query(`update proposal set status = $2, decided_by = $3, decided_at = $4, note = $5 where id = $1`, [rule.proposal, status, status === 'superseded' ? 'agent:pelago' : rule.by, e.at, note]);
}

/** One entry of any stream, projected: its facts, then what it says of the review queue. */
export async function projectEntry(tx: Q, reg: Kinds, e: Entry): Promise<void> {
  if (e.stream === 'facts') await projectFacts(tx, reg, e.at, e.facts, MOVED.includes(e.action as string));
  await projectDecision(tx, e);
}

/** The tables the log projects into, and the order a rebuild empties and fills them in. */
export const PROJECTED = ['proposal', 'mention', 'part_closure', 'relation', 'entity'];

/** The order both streams are projected in: by time, a held change before what decides it in the same moment, then by position. */
export const inOrder = (a: Entry, b: Entry) =>
  Date.parse(a.at) - Date.parse(b.at) || (a.stream === 'pending' ? 0 : 1) - (b.stream === 'pending' ? 0 : 1) || a.pos - b.pos;

/**
 * Every projection made again from the log: the tables emptied, then each entry of both streams projected in the
 * order it was appended. Run on a copy of the log (the test does); src/rebuild.ts does it in the background.
 */
export async function rebuild(tx: Q, reg: Kinds, all: Entry[]): Promise<void> {
  for (const table of PROJECTED) await tx.query(`delete from ${table}`);
  for (const e of [...all].sort(inOrder)) await projectEntry(tx, reg, e);
}

/** The schema a rebuild projects into, beside the live tables, until it is swapped in (src/rebuild.ts). */
export const SHADOW = 'pelago_rebuild';

/** A projection's rows, table by table: what a snapshot keeps. */
export type Rows = { entity: Props[]; relation: Props[]; proposal: Props[] };

/** Empty copies of the projected tables in the shadow schema: their columns, defaults and indexes; no policy, trigger or foreign key. */
export async function shadowTables(tx: Q): Promise<void> {
  for (const t of PROJECTED) await tx.query(`drop table if exists ${SHADOW}.${t}`);
  for (const t of PROJECTED) await tx.query(`create table ${SHADOW}.${t} (like public.${t} including defaults including indexes)`);
}

/** The rows of the projected tables the search path names first (the shadow's in a rebuild), in order of id. */
export async function projectedRows(tx: Q): Promise<Rows> {
  const out = {} as Rows;
  for (const t of ['entity', 'relation', 'proposal'] as const) out[t] = (await tx.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from ${t} t order by id`)).rows.map((r) => r.row);
  return out;
}

/** A snapshot's rows put back into the projected tables the search path names first, items before the links that name them. */
export async function loadRows(tx: Q, rows: Partial<Rows>): Promise<void> {
  for (const t of ['entity', 'relation', 'proposal'] as const) {
    const all = rows[t] ?? [];
    for (let i = 0; i < all.length; i += 5000) {
      await tx.query(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(all.slice(i, i + 5000))]);
    }
  }
}

/**
 * What the log never made, from today's tables: a map older than its log (24 Oct 2026) holds items and links no entry
 * made, and held changes no entry records, so a walk from the log's start begins with them, as they stand. What the
 * log then says of them is said on top, so the head comes out as it is; a past position shows a value the log has not
 * said yet as it stands today. Without them a rebuild would take them from the map, as the log says nothing of them.
 */
export async function beforeTheLog(tx: Q, kept: string[]): Promise<Rows> {
  const read = async (sql: string, params: unknown[] = []) => (await tx.query<{ row: Props }>(sql, params)).rows.map((r) => r.row);
  return {
    entity: await read(
      `select to_jsonb(e) || jsonb_build_object('props', e.props - $1::text[]) as row from public.entity e where not exists (
         select 1 from log_fact t join log_fact h on h.stream = t.stream and h.pos = t.pos and h.id = t.id
         where t.id = e.id and t.field = 'type' and t.op = '+' and t.stream = 'facts' and h.field = 'title' and h.op = '+') -- index log_fact_history`,
      [kept],
    ),
    // A link's type said again by a pack that took it over does not make it.
    relation: await read(
      `select to_jsonb(r) as row from public.relation r where not exists (
         select 1 from log_fact f join log_entry l on l.stream = f.stream and l.pos = f.pos
         where f.id = r.id and f.field = 'link' and f.op = '+' and f.stream = 'facts' and coalesce(l.head #>> '{action}', '') <> all($1::text[])) -- index log_fact_history`,
      [MOVED],
    ),
    proposal: await read(`select to_jsonb(p) as row from public.proposal p where not exists (select 1 from log_entry l where l.id = p.id) -- index log_entry_id`),
  };
}

const ITEM = ['type', 'kind', 'title', 'body', 'status', 'is_open', 'owner', 'visibility', 'confidence', 'source_id', 'private_to', 'created_at', 'updated_at', 'archived_at'];
const LINK = ['type', 'from_id', 'to_id', 'props', 'confidence', 'source_id', 'valid_from', 'valid_to'];
const QUEUE = ['ts', 'actor', 'reason', 'source', 'ops', 'warnings', 'status', 'decided_by', 'decided_at', 'note', 'private_to', 'held_by'];
/** What the fact stream never said (a claim's holds link, kept in its own stream) is not the rebuild's to take away. */
const SAID = (alias: string) => `exists (select 1 from log_fact f where f.id = ${alias}.id)`;

/**
 * The shadow's rows swapped in for the live ones, in the transaction that holds both streams' locks: what differs is
 * written, what is the same is left, so the live tables keep their policies, triggers and foreign keys, and a page
 * never sees them half made. An item keeps the operational fields kept on it (KEPT_FIELDS, not facts). Answers how
 * many rows of each table it wrote.
 */
export async function swapIn(tx: Q, kept: string[]): Promise<Record<string, number>> {
  const n = async (sql: string, params: unknown[] = []) => (await tx.query(`${sql} returning 1`, params)).rows.length;
  const set = (cols: string[]) => cols.map((c) => `${c} = s.${c}`).join(', ');
  const differs = (cols: string[], a: string, b: string) => `(${cols.map((c) => `${a}.${c}`).join(', ')}) is distinct from (${cols.map((c) => `${b}.${c}`).join(', ')})`;
  const props = `(s.props || coalesce((select jsonb_object_agg(k, v) from jsonb_each(e.props) x(k, v) where k = any($1::text[])), '{}'))`;
  const out: Record<string, number> = {};
  out.entity = await n(`insert into public.entity select * from ${SHADOW}.entity s where not exists (select 1 from public.entity e where e.id = s.id)`);
  out.entity += await n(
    `update public.entity e set ${set(ITEM)}, props = ${props} from ${SHADOW}.entity s
     where e.id = s.id and (${differs(ITEM, 'e', 's')} or (e.props - $1::text[]) is distinct from s.props)`,
    [kept],
  );
  out.relation = await n(`insert into public.relation select * from ${SHADOW}.relation s where not exists (select 1 from public.relation e where e.id = s.id)`);
  out.relation += await n(`update public.relation e set ${set(LINK)} from ${SHADOW}.relation s where e.id = s.id and ${differs(LINK, 'e', 's')}`);
  out.relation += await n(`delete from public.relation e where ${SAID('e')} and not exists (select 1 from ${SHADOW}.relation s where s.id = e.id)`);
  out.entity += await n(`delete from public.entity e where ${SAID('e')} and not exists (select 1 from ${SHADOW}.entity s where s.id = e.id)`);
  out.proposal = await n(`insert into public.proposal select * from ${SHADOW}.proposal s where not exists (select 1 from public.proposal e where e.id = s.id)`);
  out.proposal += await n(`update public.proposal e set ${set(QUEUE)} from ${SHADOW}.proposal s where e.id = s.id and ${differs(QUEUE, 'e', 's')}`);
  out.proposal += await n(`delete from public.proposal e where not exists (select 1 from ${SHADOW}.proposal s where s.id = e.id)`);
  // What is inside what and what names what, as the shadow's links and items make them (src/closure.ts, src/mentions.ts).
  for (const [t, a, b] of [['part_closure', 'ancestor', 'descendant'], ['mention', 'from_id', 'to_id']]) {
    const same = (x: string, y: string) => `${x}.${a} = ${y}.${a} and ${x}.${b} = ${y}.${b}`;
    out[t] = await n(`insert into public.${t} select * from ${SHADOW}.${t} s where not exists (select 1 from public.${t} p where ${same('p', 's')})`);
    out[t] += await n(`delete from public.${t} p where not exists (select 1 from ${SHADOW}.${t} s where ${same('p', 's')})`);
  }
  return out;
}

/**
 * What the log does not hold yet, laid back on items a rebuild made elsewhere (a move, src/move.ts): the operational
 * fields kept on them (KEPT_FIELDS in src/operational.ts), as they were.
 */
export async function keepFields(tx: Q, kept: { id: string; kept: Record<string, unknown> }[]): Promise<void> {
  for (const r of kept) await tx.query(`update entity set props = props || $2::jsonb where id = $1`, [r.id, JSON.stringify(r.kept)]);
}

/**
 * Take the fact stream's lock and say the time its next entry will have, as append will (the transaction's time,
 * never before the last entry's). The write path projects with it before it appends, so it holds the lock from the
 * start: nothing can be appended in between.
 */
export async function stamp(tx: Q): Promise<string> {
  await tx.query(`select pg_advisory_xact_lock(hashtext('pelago.log'), hashtext('facts'))`);
  const { rows } = await tx.query<{ now: Date; at: Date | null }>(`select date_trunc('milliseconds', now()) as now, (select at from log_entry where stream = 'facts' order by at desc, pos desc limit 1) as at`);
  return new Date(Math.max(new Date(rows[0].now).getTime(), rows[0].at ? new Date(rows[0].at).getTime() : 0)).toISOString();
}
