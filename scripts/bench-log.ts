// The log at size (docs/log.md, section 9), read and written through src/log.ts as the server does: a fact stream of
// ENTRIES change sets laid down over three years, then the reads that partitioning by time is for (an as-of value,
// a page from a past position, a stretch of time, the newest activity, a change set by id) and an append on top.
//   node scripts/bench-log.ts [--entries 1000000] [--runs 30] [--seed 1] [--dir <folder>] [--fresh] [--unit year | month]
// --url postgres://user:password@host:port/<database> lays it down on a Postgres server instead, in a database the
// bench makes (and with --fresh drops first); never the server's own map.
// --unit lays a partitioned log down by another length of partition than the schema's, to compare the two.
// The map goes under PELAGO_BENCH_DIR (the temp folder unless set) in log-<entries>-<seed>/, kept for the next run.
// It runs against whatever schema the checkout has, so the same command times the log before and after a change:
// opening a map laid down by an older checkout applies the new steps, and how long that took is in the results.
// scripts/gen-map.ts writes today's tables, not the log; this lays down the log itself. Results go beside the map.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt);
const ENTRIES = Number(opt('entries', '1000000'));
const RUNS = Number(opt('runs', '30'));
const SEED = Number(opt('seed', '1'));
const dir = opt('dir', join(process.env.PELAGO_BENCH_DIR ?? join(tmpdir(), 'pelago-scale'), `log-${ENTRIES}-${SEED}`));
const URL_ = opt('url', '');
if (args.includes('--fresh')) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
let made = false;
if (URL_) {
  const { default: pg } = await import('pg');
  const name = new URL(URL_).pathname.slice(1);
  if (!/^pelago_bench_\w+$/.test(name)) throw new Error('Name a database pelago_bench_<something> in --url: the bench makes and drops it.');
  const admin = new pg.Client({ connectionString: Object.assign(new URL(URL_), { pathname: '/postgres' }).toString() });
  await admin.connect();
  if (args.includes('--fresh')) await admin.query(`drop database if exists ${name}`);
  made = !(await admin.query(`select 1 from pg_database where datname = $1`, [name])).rows.length;
  if (made) await admin.query(`create database ${name}`);
  await admin.end();
}

const { openDb } = await import('../src/db.ts');
const { entryHash, GENESIS } = await import('../src/jcs.ts');
const log = await import('../src/log.ts');
const { readEvents } = await import('../src/eventlog.ts');

const say = (line: string) => console.log(line);
const results: Record<string, unknown> = { db: URL_ ? 'postgres' : 'pglite', entries: ENTRIES, seed: SEED, runs: RUNS, at: new Date().toISOString() };

// A small seeded generator (mulberry32): the same seed lays down the same log.
let s = SEED >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const idOf = (prefix: string, n: number) => `${prefix}_${n.toString(36).padStart(8, '0')}`;

const DAY = 86_400_000;
const END = Date.now() - DAY;
const START = END - 1095 * DAY;
const ITEMS = Math.max(10, Math.floor(ENTRIES / 4));
const STATUSES = ['todo', 'doing', 'done', 'blocked'];

/** Entry i of the log: a few facts on an item a team would touch, new items first and their lives after. */
function factsOf(i: number): [string, string, string, unknown][] {
  if (i % 4 === 0 && i / 4 < ITEMS) {
    const id = idOf('e', i / 4);
    return [['+', id, 'type', 'work.task'], ['+', id, 'title', `Task ${i / 4} of the bench`], ['+', id, 'status', 'todo'], ['+', id, 'visibility', 'shared']];
  }
  const made = Math.max(1, Math.min(ITEMS, Math.floor(i / 4)));
  // Most changes are to recent work, some to anything.
  const n = rand() < 0.8 ? Math.max(0, made - 1 - Math.floor(rand() * Math.min(made, 2000))) : Math.floor(rand() * made);
  const id = idOf('e', n);
  const out: [string, string, string, unknown][] = [['+', id, 'status', pick(STATUSES)]];
  if (rand() < 0.5) out.push(['+', id, 'body', `Note ${i}: what happened, in a sentence or two of an agent's words.`]);
  if (rand() < 0.3) out.push(['+', idOf('r', i), 'link', ['depends_on', id, idOf('e', Math.floor(rand() * made))]]);
  if (rand() < 0.2) out.push(['+', id, 'priority', pick(['low', 'normal', 'high'])]);
  return out;
}

async function lay(db: Awaited<ReturnType<typeof openDb>>) {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from log_entry where stream = 'facts'`);
  if (rows[0].n >= ENTRIES) return say(`log: ${rows[0].n} entries already there`);
  if (rows[0].n) throw new Error(`${dir} holds a log of ${rows[0].n} entries; run with --fresh`);
  const cols = (await db.query<{ c: string }>(`select column_name as c from information_schema.columns where table_name = 'log_fact'`)).rows.map((r) => r.c);
  const withAt = cols.includes('at');
  const months = (await db.query<{ p: string | null }>(`select to_regproc('pelago_log_periods')::text as p`)).rows[0].p;
  if (months) results.unit = (await db.query<{ u: string }>(`select pelago_log_unit() as u`)).rows[0].u;
  if (months) await db.query(`select pelago_log_periods($1, now() + interval '2 months')`, [new Date(START).toISOString()]);
  const t = performance.now();
  let prev = GENESIS;
  const BATCH = 5000;
  for (let from = 0; from < ENTRIES; from += BATCH) {
    const heads: unknown[] = [];
    const facts: unknown[] = [];
    for (let i = from; i < Math.min(ENTRIES, from + BATCH); i++) {
      const at = new Date(START + Math.floor(((END - START) * i) / ENTRIES)).toISOString();
      const said = factsOf(i);
      const head = { v: 1, ws: 'default', id: idOf('c', i), actor: { id: 'human:bench' }, reason: 'Bench', authority: { of: 'human', who: 'human:bench' }, rule: { outcome: 'apply', spared: [] }, source: null, undoes: null, keys: [] };
      const e = { ...head, stream: 'facts', pos: i + 1, at, facts: said, prev } as Record<string, unknown>;
      const hash = entryHash(e);
      heads.push({ stream: 'facts', pos: i + 1, id: head.id, at, head, prev, hash });
      said.forEach((f, n) => facts.push({ stream: 'facts', pos: i + 1, at, n, op: f[0], id: f[1], field: f[2], value: f[3] }));
      prev = hash;
    }
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into log_entry (stream, pos, id, at, head, prev, hash)
         select stream, pos, id, at, head, decode(prev, 'hex'), decode(hash, 'hex') from jsonb_to_recordset($1::jsonb) as x(stream text, pos bigint, id text, at timestamptz, head jsonb, prev text, hash text) order by pos`,
        [JSON.stringify(heads)],
      );
      await tx.query(
        `insert into log_fact (stream, pos, n, op, id, field, value${withAt ? ', at' : ''})
         select stream, pos, n, op, id, field, value${withAt ? ', at' : ''} from jsonb_to_recordset($1::jsonb) as x(stream text, pos bigint, at timestamptz, n int, op text, id text, field text, value jsonb)`,
        [JSON.stringify(facts)],
      );
    });
    if ((from / BATCH) % 40 === 0) say(`  ${from + BATCH} entries, ${((performance.now() - t) / 1000).toFixed(0)} s`);
  }
  await db.query('analyze');
  results.lay_s = Math.round((performance.now() - t) / 1000);
  say(`log laid down: ${ENTRIES} entries in ${results.lay_s} s`);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];
const timings: Record<string, { median: number; p95: number }> = {};
async function time(name: string, fn: () => Promise<unknown>, runs = RUNS) {
  await fn(); // warm
  const ms: number[] = [];
  for (let r = 0; r < runs; r++) {
    const t = performance.now();
    await fn();
    ms.push(performance.now() - t);
  }
  timings[name] = { median: Number(median(ms).toFixed(2)), p95: Number(p95(ms).toFixed(2)) };
  say(`${name.padEnd(36)} ${timings[name].median.toFixed(2).padStart(9)} ms  (p95 ${timings[name].p95.toFixed(2)})`);
}

const where = URL_ || join(dir, 'data');
const fresh = URL_ ? made : !existsSync(where);
let t = performance.now();
let db = await openDb(where);
results[fresh ? 'made_ms' : 'opened_ms'] = Math.round(performance.now() - t); // an older map's: the new steps applied
say(`${fresh ? 'made' : 'opened'} in ${Math.round(performance.now() - t)} ms`);
if (fresh && args.includes('--unit')) {
  // The partitions opening made, still empty, go first: the other length's would overlap them. Then a new connection,
  // so no plan made with the schema's length is kept.
  for (const t of ['log_fact', 'log_entry', 'log_op']) for (const { p } of (await db.query<{ p: string }>(`select relid::text as p from pg_partition_tree($1::regclass) where isleaf`, [t])).rows) await db.query(`alter table ${t} detach partition ${p}; drop table ${p}`);
  await db.query(`create or replace function pelago_log_unit() returns text language sql immutable as $fn$ select '${opt('unit', 'year') === 'month' ? 'month' : 'year'}' $fn$`);
  await db.close();
  db = await openDb(where);
}
await lay(db);

const head = await log.headOf(db);
const someItem = () => idOf('e', Math.floor(rand() * ITEMS));
const somePos = () => 1 + Math.floor(rand() * (head.pos - 1));
const busy = (await db.query<{ id: string }>(`select id from log_fact where field = 'status' and id like 'e_%' group by id order by count(*) desc limit 1`)).rows[0].id;
const dayAgo = new Date(END - DAY).toISOString();
const monthAgo = new Date(END - 30 * DAY).toISOString();

await time('head of the stream', () => log.headOf(db));
await time('as of: a field at a random position', () => log.factAt(db, someItem(), 'status', somePos()));
await time('as of: a field at a position a year back', () => log.factAt(db, busy, 'status', Math.floor(head.pos * 0.66)));
await time('as of: a field now', () => log.factAt(db, someItem(), 'status'));
await time('a change set by id', () => log.entry(db, idOf('c', somePos() - 1)));
await time('a page of 500 from a random position', () => log.stored(db, 'facts', somePos(), 500));
await time('undone yet? (by undoes)', () => db.query(`select 1 from log_entry where undoes = $1 and stream = 'facts'`, [idOf('c', somePos())]));
await time('entries in a week a year back', () => db.query(`select count(*) from log_entry where stream = 'facts' and at >= $1 and at < $2`, [new Date(END - 365 * DAY).toISOString(), new Date(END - 358 * DAY).toISOString()]));
await time('an item\'s whole history', () => db.query(`select pos, field, value from log_fact where stream = 'facts' and id = $1 order by pos, n`, [busy]));
await time('activity: newest 50', () => readEvents(db, { limit: 50 }));
await time('activity: since a day', () => readEvents(db, { since: dayAgo, limit: 50 }));
await time('activity: since a month', () => readEvents(db, { since: monthAgo, limit: 50 }));
await time('activity: about the busiest item', () => readEvents(db, { target: busy, limit: 50 }), Math.min(RUNS, 10));
// Items of their own, so each run seals with keys it makes, as a change set that creates them does.
const said = (n: number) => Array.from({ length: n }, (_, i) => ['+', `e_b${randomUUID().slice(0, 12)}`, i ? 'priority' : 'status', i ? 'high' : 'doing'] as ['+', string, string, unknown]);
const appendOf = (n: number) => () =>
  db.transaction((tx) => log.append(tx, 'default', 'facts', { id: `c_b${randomUUID().slice(0, 12)}`, actor: { id: 'human:bench' }, reason: 'Bench append', authority: null, rule: { outcome: 'apply', spared: [] }, source: null, undoes: null }, said(n)));
await time('append: 1 fact', appendOf(1));
await time('append: 5 facts', appendOf(5));
await time('append: 15 facts', appendOf(15));

// The chain read back and hashed, as verify does, over the first 100,000 entries.
t = performance.now();
let checked = 0;
for (let page = await log.stored(db, 'facts', 1, 2000); page.length && checked < 100_000; page = await log.stored(db, 'facts', checked + 1, 2000)) {
  for (const e of page) if (entryHash(e) !== e.hash) throw new Error(`entry ${e.pos} does not hash to itself`);
  checked += page.length;
}
results.verify_entries_per_s = Math.round(checked / ((performance.now() - t) / 1000));
say(`verify: ${results.verify_entries_per_s} entries a second`);

const size = async (table: string) =>
  Number((await db.query<{ b: string }>(`select coalesce(sum(pg_total_relation_size(relid)), pg_total_relation_size($1::regclass))::text as b from pg_partition_tree($1::regclass)`, [table])).rows[0].b);
results.mb = Object.fromEntries(await Promise.all(['log_entry', 'log_fact'].map(async (tb) => [tb, Math.round((await size(tb)) / 1e6)])));
results.partitions = Number((await db.query<{ n: string }>(`select count(*)::text as n from pg_partition_tree('log_entry'::regclass) where isleaf and relid <> 'log_entry'::regclass`)).rows[0].n);
say(`size: ${JSON.stringify(results.mb)} MB, ${results.partitions} partitions of log_entry`);
results.timings = timings;
await db.close();
const out = join(dir, `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify(results, null, 2));
say(`results: ${out}`);
