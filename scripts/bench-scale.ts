// The views at year-three size, in one command (npm run bench:scale): a map of EVENTS events generated from a seed
// (scripts/gen-map.ts), a throwaway server on it, scripts/bench-views.ts run against it as it is, then what that does
// not time: a change set of a few ops, undo, approving a held change, changed_since over a day and a month, the
// server's open, backup and restore, and the size on disk.
//   node scripts/bench-scale.ts [--db pglite | postgres] [--events 10000000] [--seed 1] [--runs 5] [--fresh]
// PGlite maps go under PELAGO_BENCH_DIR (the temp folder unless set); for Postgres, PELAGO_BENCH_DATABASE_URL names
// a server the bench may make and drop databases on (postgres://user:password@host:port/postgres). A map is
// generated once and kept for the next run, unless --fresh; the bench undoes what it writes. The server runs on
// PELAGO_BENCH_PORT (3199) with its own data, never data/. Results go beside the map as JSON. docs/bench.md says more.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import pg from 'pg';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt);
const ROOT = join(import.meta.dirname, '..');
const NODE = [process.execPath, '--max-old-space-size=8192'];

// The backup step runs in a process of its own, as the server's does (src/backup.ts: dump, then one gzipped JSON
// file): at this size it may run out of memory, and the bench goes on to say so.
if (args[0] === '--backup') {
  const [, where, file] = args;
  const { openDb } = await import('../src/db.ts');
  const { dump } = await import('../src/backup.ts');
  const db = await openDb(where);
  const t = performance.now();
  const taken = await dump(db, { id: 'default', name: 'Bench' });
  const read = performance.now() - t;
  const bytes = gzipSync(JSON.stringify(taken));
  writeFileSync(file, bytes);
  console.log(JSON.stringify({ read_ms: Math.round(read), total_ms: Math.round(performance.now() - t), mb: Math.round(bytes.length / 1e6) }));
  await db.close();
  process.exit(0);
}

const DB = opt('db', 'pglite');
const EVENTS = Number(opt('events', '10000000'));
const SEED = Number(opt('seed', '1'));
const RUNS = Number(opt('runs', '5'));
const PORT = Number(process.env.PELAGO_BENCH_PORT ?? 3199);
const base = `http://127.0.0.1:${PORT}`;
const dir = join(process.env.PELAGO_BENCH_DIR ?? join(tmpdir(), 'pelago-scale'), `${DB}-${EVENTS}-${SEED}`);
mkdirSync(dir, { recursive: true });
const SERVER = process.env.PELAGO_BENCH_DATABASE_URL;
if (DB === 'postgres' && !SERVER) throw new Error('Set PELAGO_BENCH_DATABASE_URL to a Postgres server the bench may make databases on.');
const dbName = `pelago_scale_${EVENTS}_${SEED}`;
const named = (database: string) => Object.assign(new URL(SERVER!), { pathname: `/${database}` }).toString();
const where = DB === 'postgres' ? named(dbName) : join(dir, 'data');
const results: Record<string, unknown> = { db: DB, events: EVENTS, seed: SEED, runs: RUNS, at: new Date().toISOString() };
const say = (line: string) => console.log(line);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function admin<T>(sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: SERVER });
  await client.connect();
  try {
    return (await client.query(sql)).rows as T[];
  } finally {
    await client.end();
  }
}
const exists = async () => (DB === 'postgres' ? (await admin(`select 1 from pg_database where datname = '${dbName}'`)).length > 0 : existsSync(join(where, 'PG_VERSION')));
async function drop(target: string) {
  if (target.startsWith('postgres')) await admin(`drop database if exists ${new URL(target).pathname.slice(1)} with (force)`);
  else rmSync(target, { recursive: true, force: true });
}

// ---- the map, generated once ----
if (args.includes('--fresh') && (await exists())) await drop(where);
if (!(await exists())) {
  if (DB === 'postgres') await admin(`create database ${dbName}`);
  say(`generating ${EVENTS.toLocaleString()} events (seed ${SEED}) into ${DB === 'postgres' ? dbName : where}`);
  const t = performance.now();
  const gen = spawnSync(NODE[0], [...NODE.slice(1), 'scripts/gen-map.ts', where, '--events', String(EVENTS), '--seed', String(SEED)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (gen.status !== 0) throw new Error(`generating failed: ${gen.stdout}`);
  results.generated = { ...JSON.parse(gen.stdout.trim().split('\n').at(-1)!), seconds: Math.round((performance.now() - t) / 1000) };
  say(`generated: ${gen.stdout.trim()}`);
}

// ---- a throwaway server on it ----
const backups = join(dir, 'backups');
// The server backs up as it starts when no backup is newer than six hours; that would run under the timings, so a
// placeholder dated far ahead keeps it off, and the backup is timed apart below with the server stopped.
mkdirSync(join(backups, 'default'), { recursive: true });
writeFileSync(join(backups, 'default', '2099-01-01T00-00-00.000Z.json.gz'), '');
let server: ChildProcess | undefined;
async function start() {
  const env = { ...process.env, PELAGO_PORT: String(PORT), PELAGO_DEV: '1', PELAGO_BACKUP_DIR: backups, PELAGO_IDLE_MINUTES: '0', ...(DB === 'postgres' ? { PELAGO_DATABASE_URL: where, PELAGO_DATA: join(dir, 'data') } : { PELAGO_DATA: where }) };
  const t = performance.now();
  server = spawn(NODE[0], [...NODE.slice(1), 'src/server.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(join(dir, 'server.log'), { flags: 'a' });
  server.stdout!.pipe(log);
  server.stderr!.pipe(log);
  let exited = false;
  server.on('exit', () => (exited = true));
  for (;;) {
    if (exited) throw new Error(`the server stopped as it opened: see ${join(dir, 'server.log')}`);
    if (await fetch(`${base}/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return performance.now() - t;
}
async function stop() {
  // The restart tool (dev mode) stops the server as SIGTERM would, releasing its lock; nothing restarts it here.
  const gone = new Promise((r) => server!.once('exit', r));
  await fetch(`${base}/agent/restart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
  await Promise.race([gone, new Promise((r) => setTimeout(r, 120_000))]);
  if (server!.exitCode === null) server!.kill();
}

const opened = await start();
results.open_ms = Math.round(opened);
say(`server opened in ${seconds(opened)}`);

// ---- bench-views, as it is ----
// Each row is shown as it is timed: at this size one view can take minutes.
results.views = await new Promise((done) => {
  const views = spawn(NODE[0], ['scripts/bench-views.ts', base, String(RUNS)], { cwd: ROOT, env: { SLOW: '30000', ...process.env, JSON: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  let last = '';
  createInterface({ input: views.stdout! }).on('line', (line) => (line.startsWith('[') ? (last = line) : say(line)));
  views.on('exit', () => done(last ? JSON.parse(last) : []));
});

// ---- what bench-views does not time ----
async function call(path: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(path.startsWith('agent/') ? { actor: 'bench', ...body } : body) });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json.result;
}
const agent = (tool: string, body: Record<string, unknown> = {}) => call(`agent/${tool}`, body);
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

/** Time `run` RUNS times after one warm-up, each after an untimed `before` and followed by an untimed `after`. */
async function time<B>(label: string, run: (b: B) => Promise<unknown>, before: () => Promise<B> = async () => undefined as B, after: (b: B, out: any) => Promise<unknown> = async () => {}) {
  const ms: number[] = [];
  try {
    for (let i = 0; i <= RUNS; i++) {
      const b = await before();
      const t = performance.now();
      const out = await run(b);
      if (i) ms.push(performance.now() - t);
      await after(b, out);
    }
  } catch (err) {
    say(`${label.padEnd(34)} failed: ${(err as Error).message}`);
    return { label, error: (err as Error).message };
  }
  ms.sort((x, y) => x - y);
  const row = { label, median: Math.round(percentile(ms, 50)), p95: Math.round(percentile(ms, 95)) };
  say(`${label.padEnd(34)} ${String(row.median).padStart(7)} ${String(row.p95).padStart(7)}`);
  return row;
}

const hub = (await agent('view', { name: 'hubs' })).hubs[0].id as string;
const task = (await agent('search', { type: 'task', open: true, limit: 1 }))[0].id as string;
const ops = [
  ...[0, 1, 2].map((i) => ({ op: 'create', ref: `t${i}`, type: 'task', title: `Bench task ${i}`, body: 'Made by the bench, undone after.' })),
  ...[0, 1, 2].map((i) => ({ op: 'link', type: 'part_of', from: `t${i}`, to: hub })),
  { op: 'link', type: 'depends_on', from: 't0', to: task },
  { op: 'update', id: task, append: 'Bench: a line added, undone after.' },
];
const make = () => agent('change', { reason: 'bench: a change set of a few ops, undone after', ops });
const newest = new Date((await agent('events', { limit: 1 }))[0].ts).getTime();
say(`${'call'.padEnd(34)} ${'median'.padStart(7)} ${'p95'.padStart(7)}`);
results.more = [
  await time('change (8 ops: 3 items, 4 links, 1 update)', make, undefined, (_, out) => agent('undo', { changeset: out.changeset })),
  await time('undo (that change)', (cs: string) => agent('undo', { changeset: cs }), async () => (await make()).changeset),
  await time('approve a held change (8 ops)', (id: string) => call('api/decide', { proposal: id, approve: true }), async () => (await agent('change', { reason: 'bench: held, approved, undone after', ops, hold: true })).proposal, (_, out) => agent('undo', { changeset: out.changeset })),
  await time('view changed_since (a day)', () => agent('view', { name: 'changed_since', params: { since: new Date(newest - 86_400_000).toISOString() } })),
  await time('view changed_since (a month)', () => agent('view', { name: 'changed_since', params: { since: new Date(newest - 30 * 86_400_000).toISOString() } })),
  await time('events (newest 50)', () => agent('events', { limit: 50 })),
];
await stop();

// ---- with the server stopped: size, backup and restore ----
const folderSize = (path: string): number => (statSync(path).isDirectory() ? readdirSync(path).reduce((n, f) => n + folderSize(join(path, f)), 0) : statSync(path).size);
{
  const { openDb } = await import('../src/db.ts');
  const db = await openDb(where);
  const sizes = (await db.query<Record<string, number>>(`select pg_database_size(current_database())::bigint as database, ${['entity', 'relation', 'event', 'proposal'].map((t) => `pg_total_relation_size('${t}')::bigint as ${t}`).join(', ')}`)).rows[0];
  const counts = (await db.query<Record<string, number>>(`select (select count(*) from entity)::int as items, (select count(*) from relation)::int as links, (select count(*) from event)::int as events`)).rows[0];
  await db.close();
  results.counts = counts;
  results.size_mb = Object.fromEntries(Object.entries({ ...sizes, ...(DB === 'pglite' && { folder: folderSize(where) }) }).map(([k, v]) => [k, Math.round(Number(v) / 1e6)]));
  say(`size on disk (MB): ${JSON.stringify(results.size_mb)}; ${JSON.stringify(counts)}`);
}
const file = join(dir, 'bench-backup.json.gz');
rmSync(file, { force: true });
let t = performance.now();
const backup = spawnSync(NODE[0], [...NODE.slice(1), 'scripts/bench-scale.ts', '--backup', where, file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
results.backup = backup.status === 0 ? { ...JSON.parse(backup.stdout.trim()), process_ms: Math.round(performance.now() - t) } : { failed: (backup.stderr || backup.stdout).trim().split('\n').filter((l) => /Error|error|heap|memory/.test(l)).slice(0, 3).join(' | ') || `exit ${backup.status}`, after_ms: Math.round(performance.now() - t) };
say(`backup: ${JSON.stringify(results.backup)}`);
if (existsSync(file)) {
  const target = DB === 'postgres' ? named(`${dbName}_restored`) : join(dir, 'restored');
  await drop(target);
  if (DB === 'postgres') await admin(`create database ${dbName}_restored`);
  t = performance.now();
  const restored = spawnSync(NODE[0], [...NODE.slice(1), 'src/backup.ts', 'restore', file, target], { cwd: ROOT, encoding: 'utf8' });
  results.restore = restored.status === 0 ? { ms: Math.round(performance.now() - t) } : { failed: (restored.stderr || restored.stdout).trim().split('\n').slice(0, 2).join(' | '), after_ms: Math.round(performance.now() - t) };
  say(`restore: ${JSON.stringify(results.restore)}`);
  await drop(target);
  rmSync(file, { force: true });
}
const out = join(dir, `results-${new Date().toISOString().replaceAll(':', '-')}.json`);
writeFileSync(out, JSON.stringify(results, null, 2));
say(`results: ${out}`);
