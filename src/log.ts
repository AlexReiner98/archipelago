// The log (docs/log.md): each workspace's stored state as streams of entries, every entry carrying the hash of the one
// before it. The fact stream (`facts`) holds each applied change set; the `pending` stream each held one. An entry is
// one row of log_entry (its header) and a row of log_fact per fact, and neither table takes an update or a delete.
// Today's tables (entity, relation, proposal) are still written beside the log, in the same transaction, and stand as
// its projections until the projections task reads them from here (src/replay.ts is the first of them).

import { GENESIS, entryHash } from './jcs.ts';
import type { Q } from './db.ts';
import { openEntries, openValue, sealEntry } from './seal.ts';

export type Stream = 'facts' | 'pending';

/** One value of one field of one item, link or type asserted (`+`) or retracted (`-`); a fifth element says about the fact. */
export type Fact = ['+', string, string, unknown] | ['+', string, string, unknown, Record<string, unknown>] | ['-', string, string];

/** What decided a change set (section 3). */
export type Decision =
  | { outcome: 'apply'; spared: { rule: string; pack: string }[] }
  | { outcome: 'approved' | 'rejected' | 'superseded'; held_by: { rule: string; pack: string } | null; proposal: string; proposal_hash: string; by: string; revised?: boolean; except?: string[] };

export interface Entry {
  v: 1;
  ws: string;
  stream: Stream;
  pos: number;
  id: string;
  at: string;
  actor: { id: string; token?: string };
  reason: string;
  facts: Fact[];
  prev: string;
  hash: string;
  /** The rest of the header, by stream: rule, authority, source, action, undoes, keys; or a proposal's held_by, base, ops. */
  [field: string]: unknown;
}

/**
 * Step 18. Append-only twice over: the member role is granted no update or delete, and a trigger refuses both (and
 * truncate) from anyone, the owner included. Compaction (section 4) will be the one role the trigger lets through.
 * The history index is log_fact by (id, field, pos): the value a field held at any position is one lookup.
 */
export const LOG = `
create table if not exists log_entry (
  stream text not null,
  pos    bigint not null,
  id     text not null,
  at     timestamptz not null,
  head   jsonb not null,
  undoes text,
  prev   bytea not null,
  hash   bytea not null,
  primary key (stream, pos)
);
create unique index if not exists log_entry_id on log_entry(id);
create index if not exists log_entry_undoes on log_entry(undoes) where undoes is not null;
create table if not exists log_fact (
  stream text not null,
  pos    bigint not null,
  n      int not null,
  op     text not null check (op in ('+', '-')),
  id     text not null,
  field  text not null,
  value  jsonb,
  meta   jsonb,
  primary key (stream, pos, n),
  foreign key (stream, pos) references log_entry (stream, pos)
);
create index if not exists log_fact_history on log_fact(id, field, pos);
create or replace function pelago_log_append_only() returns trigger language plpgsql as $fn$
begin raise exception 'The log is append-only: % on % is refused', tg_op, tg_table_name; end $fn$;
drop trigger if exists log_entry_append_only on log_entry;
create trigger log_entry_append_only before update or delete on log_entry for each row execute function pelago_log_append_only();
drop trigger if exists log_entry_no_truncate on log_entry;
create trigger log_entry_no_truncate before truncate on log_entry for each statement execute function pelago_log_append_only();
drop trigger if exists log_fact_append_only on log_fact;
create trigger log_fact_append_only before update or delete on log_fact for each row execute function pelago_log_append_only();
drop trigger if exists log_fact_no_truncate on log_fact;
create trigger log_fact_no_truncate before truncate on log_fact for each statement execute function pelago_log_append_only();
revoke update, delete, truncate on log_entry, log_fact from public;
grant select, insert on log_entry, log_fact to pelago_member;
`;

/** The stream's last position and hash: 0 and the genesis hash while it is empty. */
export async function headOf(q: Q, stream: Stream = 'facts'): Promise<{ pos: number; hash: string }> {
  const { rows } = await q.query<{ pos: number; hash: string }>(`select pos::int as pos, encode(hash, 'hex') as hash from log_entry where stream = $1 order by pos desc limit 1`, [stream]);
  return rows[0] ?? { pos: 0, hash: GENESIS };
}

/**
 * Append one entry under the stream's lock: the next position, a time never before the last entry's, the hash of the
 * one before. Run it in the transaction that writes what it records, so the two stand or fall together.
 */
export async function append(tx: Q, ws: string, stream: Stream, head: { id: string; actor: Entry['actor']; reason: string; [field: string]: unknown }, facts: Fact[]): Promise<Entry> {
  // Every value that is someone's words goes in sealed with its key (src/seal.ts), and `keys` names them.
  const sealed = await sealEntry(tx, ws, stream, head, facts);
  facts = sealed.facts;
  await tx.query(`select pg_advisory_xact_lock(hashtext('pelago.log'), hashtext($1))`, [stream]);
  const { rows } = await tx.query<{ now: Date; pos: number | null; hash: string | null; at: Date | null }>(
    `select date_trunc('milliseconds', now()) as now, l.pos::int as pos, encode(l.hash, 'hex') as hash, l.at
     from (select 1) one left join lateral (select pos, hash, at from log_entry where stream = $1 order by pos desc limit 1) l on true`,
    [stream],
  );
  const last = rows[0];
  // The transaction's own time, which today's tables are written with, clamped so time order and position order agree.
  const at = new Date(Math.max(new Date(last.now).getTime(), last.at ? new Date(last.at).getTime() : 0)).toISOString();
  const { id, actor, reason, ...rest } = sealed.head as unknown as typeof head;
  const entry = { v: 1, ws, stream, pos: (last.pos ?? 0) + 1, id, at, actor, reason, ...rest, facts, prev: last.hash ?? GENESIS } as unknown as Entry;
  entry.hash = entryHash(entry);
  const { stream: _s, pos, at: _a, facts: _f, prev, hash, ...stored } = entry;
  await tx.query(`insert into log_entry (stream, pos, id, at, head, undoes, prev, hash) values ($1, $2, $3, $4, $5::jsonb, $6, decode($7, 'hex'), decode($8, 'hex'))`, [
    stream, pos, id, at, JSON.stringify(stored), (rest.undoes as string | undefined) ?? null, prev, hash,
  ]);
  if (facts.length) {
    await tx.query(
      `insert into log_fact (stream, pos, n, op, id, field, value, meta)
       select $1, $2, f.n - 1, f.x->>0, f.x->>1, f.x->>2, case when jsonb_array_length(f.x) > 3 then f.x->3 end, f.x->4
       from jsonb_array_elements($3::jsonb) with ordinality f(x, n)`,
      [stream, pos, JSON.stringify(facts)],
    );
  }
  return entry;
}

const FACTS = `coalesce((select jsonb_agg(case when f.op = '-' then jsonb_build_array(f.op, f.id, f.field)
  when f.meta is null then jsonb_build_array(f.op, f.id, f.field, f.value) else jsonb_build_array(f.op, f.id, f.field, f.value, f.meta) end order by f.n)
  from log_fact f where f.stream = e.stream and f.pos = e.pos), '[]'::jsonb)`;

type Row = { stream: Stream; pos: number; id: string; at: Date; head: Record<string, unknown>; prev: string; hash: string; facts: Fact[] };
const toEntry = (r: Row) => ({ ...r.head, stream: r.stream, pos: r.pos, id: r.id, at: new Date(r.at).toISOString(), facts: r.facts, prev: r.prev, hash: r.hash }) as Entry;
const SELECT = `select e.stream, e.pos::int as pos, e.id, e.at, e.head, encode(e.prev, 'hex') as prev, encode(e.hash, 'hex') as hash, ${FACTS} as facts from log_entry e`;

/** Entries of a stream from a position on, in order, as they are stored: sealed values sealed. */
export async function stored(q: Q, stream: Stream = 'facts', from = 1, limit = 500): Promise<Entry[]> {
  const { rows } = await q.query<Row>(`${SELECT} where e.stream = $1 and e.pos >= $2 order by e.pos limit $3`, [stream, from, limit]);
  return rows.map(toEntry);
}

/** Entries of a stream from a position on, in order, opened for whoever reads them. */
export const entries = async (q: Q, stream: Stream = 'facts', from = 1, limit = 500) => openEntries(q, await stored(q, stream, from, limit));

/** One entry by its id (a change set's c_…, a proposal's p_…). */
export async function entry(q: Q, id: string): Promise<Entry | undefined> {
  const { rows } = await q.query<Row>(`${SELECT} where e.id = $1`, [id]);
  return rows[0] && (await openEntries(q, [toEntry(rows[0])]))[0];
}

/** Walk a stream from its first entry: every position follows the last, every entry names the hash before it, every hash is its own. */
export async function verify(q: Q, stream: Stream = 'facts'): Promise<{ stream: Stream; entries: number; head: string; problems: string[] }> {
  const problems: string[] = [];
  let pos = 0;
  let prev = GENESIS;
  for (let batch = await stored(q, stream, 1); batch.length; batch = await stored(q, stream, pos + 1)) {
    for (const e of batch) {
      if (e.pos !== pos + 1) problems.push(`${stream} ${pos + 1}: missing, the next is ${e.pos}`);
      if (e.prev !== prev) problems.push(`${stream} ${e.pos} (${e.id}): names ${e.prev.slice(0, 12)}… as the entry before, which is ${prev.slice(0, 12)}…`);
      if (entryHash(e) !== e.hash) problems.push(`${stream} ${e.pos} (${e.id}): its hash is not that of what it holds`);
      pos = e.pos;
      prev = e.hash;
    }
  }
  return { stream, entries: pos, head: prev, problems };
}

/**
 * The newest fact on a field of an item or link at or before a position (all of them when none is given): what the
 * field held then. Undefined when nothing was ever said of it. The history index answers it.
 */
export async function factAt(q: Q, id: string, field: string, pos?: number): Promise<{ pos: number; op: '+' | '-'; value: unknown } | undefined> {
  const { rows } = await q.query<{ pos: number; op: '+' | '-'; value: unknown }>(
    `select pos::int as pos, op, value from log_fact where stream = 'facts' and id = $1 and field = $2 and ($3::bigint is null or pos <= $3) order by pos desc, n desc limit 1`,
    [id, field, pos ?? null],
  );
  return rows[0] && { ...rows[0], value: await openValue(q, id, field, rows[0].value) };
}
