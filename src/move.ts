// Moving a map between PGlite and a Postgres server (docs/log.md, section 12): a replay of its log, checked on both
// sides. The source's chains are verified; every entry is carried as it is stored (sealed, with its position, time and
// hash) and projected into the tables every page reads, in the order a rebuild projects it; what is kept beside the
// log is carried as rows; then the target's chains are verified and its projections compared with the source's, row
// for row. Only then is it moved. The same steps carry a map back.
//
//   node src/cli.ts move <from: data folder | postgres://…> <to: data folder | postgres://…>
//
// Run it with no server on either database. The target must be empty: a folder that does not exist yet, or a new
// database on the server (each workspace is its own database, src/pg.ts). What is sealed stays sealed, so a server on
// the target must have the sealing key the source's had (src/secrets.ts).

import { createHash } from 'node:crypto';
import type { Db, Q } from './db.ts';
import { jcs } from './jcs.ts';
import { stored, verify, type Entry, type Stream } from './log.ts';
import { KEPT_FIELDS } from './operational.ts';
import type { Registry } from './packs.ts';
import { keepFields, PROJECTED, projectEntry } from './replay.ts';
import { openEntries, openSaid } from './seal.ts';
import { verifySegments } from './streams.ts';

/** The log's own tables: carried entry by entry, never as plain rows. */
const LOG_TABLES = ['log_entry', 'log_fact'];
/** Never carried: the schema's own step, made by the target as it opens, and what is never stored for long (transient). */
const LEFT = ['schema_version', 'transient'];
const PAGE = 500;

export interface MoveReport {
  entries: Record<Stream, number>;
  head: Record<Stream, string>;
  /** Rows carried beside the log, by table. */
  rows: Record<string, number>;
  /** Rows of each projection, the same on both sides. */
  projected: Record<string, number>;
  segments: number;
}

/** The tables a database holds, as the schema made them: a partitioned one by its parent, which reads all of it. */
async function tables(q: Q): Promise<string[]> {
  const { rows } = await q.query<{ name: string }>(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition order by 1`);
  return rows.map((r) => r.name);
}

/** The columns of a table one can write: not those the database makes itself. */
async function writable(q: Q, table: string): Promise<string[]> {
  const { rows } = await q.query<{ name: string }>(
    `select column_name as name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' and identity_generation is null order by ordinal_position`,
    [table],
  );
  return rows.map((r) => `"${r.name}"`);
}

async function count(q: Q, table: string): Promise<number> {
  return (await q.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
}

/** Rows of a table in pages, in a fixed order, as JSON. */
async function* rowsOf(q: Q, table: string, order: string): AsyncGenerator<Record<string, unknown>[]> {
  for (let offset = 0; ; offset += PAGE) {
    const { rows } = await q.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from ${table} t order by ${order} limit ${PAGE} offset ${offset}`);
    if (!rows.length) return;
    yield rows.map((r) => r.row);
    if (rows.length < PAGE) return;
  }
}

async function insert(tx: Q, table: string, columns: string[], rows: Record<string, unknown>[]) {
  const list = columns.join(', ');
  await tx.query(`insert into ${table} (${list}) select ${list} from jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
}

/** Both streams as stored, merged into the order a rebuild projects them (src/replay.ts): by time, a held change before what decides it, by position. */
async function* inOrder(q: Q): AsyncGenerator<Entry> {
  const page = async (stream: Stream, from: number) => stored(q, stream, from, PAGE);
  const next = { facts: await page('facts', 1), pending: await page('pending', 1) };
  const key = (e: Entry) => [Date.parse(e.at), e.stream === 'pending' ? 0 : 1, e.pos];
  for (;;) {
    const [f, p] = [next.facts[0], next.pending[0]];
    if (!f && !p) return;
    let take: Stream;
    if (!f) take = 'pending';
    else if (!p) take = 'facts';
    else {
      const [a, b] = [key(f), key(p)];
      take = (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) < 0 ? 'facts' : 'pending';
    }
    const e = next[take].shift()!;
    if (!next[take].length) next[take] = await page(take, e.pos + 1);
    yield e;
  }
}

/** A table's rows hashed in id order, read the same way on both sides: what a comparison of the projections compares. */
async function digest(q: Q, table: string): Promise<{ rows: number; hash: string; ids: string[] }> {
  const hash = createHash('sha256');
  let rows = 0;
  const ids: string[] = [];
  for await (const page of rowsOf(q, table, 'id')) {
    for (const row of page) {
      hash.update(jcs(row));
      hash.update('\n');
      ids.push(createHash('sha256').update(jcs(row)).digest('hex').slice(0, 16) + ' ' + String(row.id));
    }
    rows += page.length;
  }
  return { rows, hash: hash.digest('hex'), ids };
}

async function chains(q: Q, where: string) {
  const out = { entries: {} as Record<Stream, number>, head: {} as Record<Stream, string> };
  for (const stream of ['facts', 'pending'] as const) {
    const v = await verify(q, stream);
    if (v.problems.length) throw new Error(`The ${stream} stream ${where} does not verify: ${v.problems.slice(0, 3).join('; ')}`);
    out.entries[stream] = v.entries;
    out.head[stream] = v.head;
  }
  const s = await verifySegments(q);
  if (s.problems.length) throw new Error(`The segments ${where} do not verify: ${s.problems.slice(0, 3).join('; ')}`);
  return { ...out, segments: s.segments };
}

/**
 * Carry the map in `from` into the empty database `to` by replaying its log, and check that both hold the same map.
 * `registry` is the source's (its packs and its own types): it says which statuses are open and what kind a type is.
 * Throws, leaving the target as it was, when the source does not verify or the two do not agree: the target is
 * checked in the transaction that fills it.
 */
export async function move(from: Db, to: Db, registry: Registry): Promise<MoveReport> {
  const before = await chains(from, 'in the source');
  // Projected in clear, the words must open here: with another key they would arrive as digests.
  const { rows: one } = await from.query<{ id: string; field: string; value: unknown }>(`select id, field, value from log_fact where value ? '$c' limit 1`);
  const [said] = await openSaid(from, one);
  if (said && typeof said.value === 'object' && said.value !== null && '$h' in said.value) {
    throw new Error('The sealed words in the source do not open with the sealing key here: give the key its server had (PELAGO_SECRETS_KEY).');
  }
  const here = await tables(from);
  const there = new Set(await tables(to));
  const missing = here.filter((t) => !there.has(t) && !LEFT.includes(t));
  if (missing.length) throw new Error(`The target lacks ${missing.join(', ')}: open it with this version first.`);
  const carried = here.filter((t) => !LEFT.includes(t) && !LOG_TABLES.includes(t) && !PROJECTED.includes(t));
  for (const t of [...LOG_TABLES, ...PROJECTED, ...carried]) {
    const n = await count(to, t);
    if (n) throw new Error(`The target is not empty (${t} has ${n} rows): move into a new folder or a new database.`);
  }

  const rows: Record<string, number> = {};
  const projected: Record<string, number> = {};
  let after!: Awaited<ReturnType<typeof chains>>;
  await to.transaction(async (tx) => {
    await tx.query(`set local timezone = 'UTC'`);
    // The key vault first, so what lands sealed can be opened here as it was there.
    const vault = carried.filter((t) => t.startsWith('vault_'));
    for (const t of vault) rows[t] = await carry(from, tx, t);

    // The log, entry by entry as stored, each projected as it lands.
    const columns = { entry: await writable(tx, 'log_entry'), fact: await writable(tx, 'log_fact') };
    for await (const e of inOrder(from)) {
      const entry = await from.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from log_entry t where stream = $1 and pos = $2`, [e.stream, e.pos]);
      await insert(tx, 'log_entry', columns.entry, entry.rows.map((r) => r.row));
      const facts = await from.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from log_fact t where stream = $1 and pos = $2 order by n`, [e.stream, e.pos]);
      if (facts.rows.length) await insert(tx, 'log_fact', columns.fact, facts.rows.map((r) => r.row));
      // Opened where every item it names is seen (the source), to be projected here in clear.
      const [open] = await openEntries(from, [e]);
      await projectEntry(tx, registry, open);
    }

    // What the log does not hold yet stays as rows: a run's heartbeat and the like on an item (src/operational.ts).
    const { rows: kept } = await from.query<{ id: string; kept: Record<string, unknown> }>(
      `select id, (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(props) p(k, v) where k = any($1::text[])) as kept from entity where props ?| $1::text[]`,
      [KEPT_FIELDS],
    );
    await keepFields(tx, kept);

    // The stores beside the log, as rows. A table whose rows point at one not carried yet waits for the next pass.
    let left = carried.filter((t) => !vault.includes(t));
    while (left.length) {
      const failed: string[] = [];
      let last: unknown;
      for (const t of left) {
        await tx.query(`savepoint carry`);
        try {
          rows[t] = await carry(from, tx, t);
          await tx.query(`release savepoint carry`);
        } catch (err) {
          await tx.query(`rollback to savepoint carry`);
          failed.push(t);
          last = err;
        }
      }
      if (failed.length === left.length) throw new Error(`Could not carry ${failed.join(', ')}: ${(last as Error).message}`);
      left = failed;
    }
    // Numbers drawn from a sequence go on after the highest carried.
    await tx.query(`select setval('event_seq_seq', greatest((select coalesce(max(seq), 0) from event), (select coalesce(max(seq), 0) from log_fact), 1))`);
    if (there.has('local_type')) await tx.query(`select setval(pg_get_serial_sequence('local_type', 'n'), greatest((select coalesce(max(n), 0) from local_type), 1))`);

    // Checked before it is committed: a target that does not agree is left as it was.
    after = await chains(tx, 'in the target');
    for (const stream of ['facts', 'pending'] as const) {
      if (after.head[stream] !== before.head[stream] || after.entries[stream] !== before.entries[stream]) {
        throw new Error(`The ${stream} stream did not arrive whole: ${before.entries[stream]} entries there, ${after.entries[stream]} here.`);
      }
    }
    for (const t of PROJECTED) {
      const [a, b] = [await inUtc(from, (q) => digest(q, t)), await digest(tx, t)];
      if (a.hash !== b.hash) {
        const differ = new Set(b.ids);
        const first = a.ids.find((x) => !differ.has(x));
        throw new Error(`The ${t} rows replayed are not the source's (${a.rows} there, ${b.rows} here; first to differ: ${first?.split(' ')[1] ?? 'one the source lacks'}).`);
      }
      projected[t] = a.rows;
    }
    for (const t of carried) {
      const [a, b] = [await count(from, t), await count(tx, t)];
      if (a !== b) throw new Error(`${t}: ${a} rows there, ${b} here.`);
    }
  });
  return { entries: after.entries, head: after.head, rows, projected, segments: after.segments };
}

/** One table's rows, every page, into the target. */
async function carry(from: Q, tx: Q, table: string): Promise<number> {
  const columns = await writable(tx, table);
  let n = 0;
  for await (const page of rowsOf(from, table, 'ctid')) {
    await insert(tx, table, columns, page);
    n += page.length;
  }
  return n;
}

/** Read in one transaction with times written in UTC, so both sides spell a time the same way. */
const inUtc = <T>(db: Db, fn: (q: Q) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.query(`set local timezone = 'UTC'`);
    return fn(tx);
  });
