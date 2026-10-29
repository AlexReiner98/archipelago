// What the limits per plan (src/plan.ts) rest on, measured here and never on the live server: a workspace's storage
// (its log and pictures, as the limit counts them, and the folder it takes on disk), the memory of a server process
// with N workspaces open, the requests a minute it answers, and how many requests a minute real sessions make.
//
//   node --expose-gc scripts/measure-plan.ts --data <data folder> [--open N] [--seconds S] [--database-url <postgres>]
//   node scripts/measure-plan.ts --transcripts [folder] [--days D]
//
// --data is a copy of a map, such as one `npm run pull` made with its own PELAGO_DATA (never the folder a running
// server has: the lock refuses it). Its workspaces' storage is reported. Then, in a scratch folder (or on the Postgres
// server --database-url names, as hosting runs, in databases dropped after), two new empty workspaces are opened and
// N made from the backup pull kept beside the copy, the process's memory read after each (an upper bound: each is the
// whole of that map). Then one of them is asked a busy session's reads and writes for S seconds through the server's
// own routes, one request at a time, for the rate one process answers. --transcripts reads Claude Code's session
// files (~/.claude/projects) from the last D days: the pelago tool calls each session made a minute.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createToken } from '../src/auth.ts';
import { parseBackup, readVault, type Dump } from '../src/backup.ts';
import { storageBytes, bytes } from '../src/plan.ts';
import { configureSecrets } from '../src/secrets.ts';
import { createHttpServer } from '../src/server.ts';
import { Workspaces } from '../src/workspaces.ts';

const { values: opt } = parseArgs({ options: { data: { type: 'string' }, 'database-url': { type: 'string' }, open: { type: 'string', default: '5' }, seconds: { type: 'string', default: '20' }, transcripts: { type: 'string' }, days: { type: 'string', default: '14' } } });
const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
const folderSize = (dir: string): number => readdirSync(dir, { withFileTypes: true }).reduce((n, f) => n + (f.isDirectory() ? folderSize(join(dir, f.name)) : statSync(join(dir, f.name)).size), 0);
const rss = () => {
  globalThis.gc?.();
  return process.memoryUsage().rss;
};
const packsDir = join(import.meta.dirname, '..', 'packs');

/** Storage of each workspace in a data folder, as the storage limit counts it and as its folder takes on disk. */
async function storage(dataDir: string) {
  const rootDir = join(dataDir, '..', 'workspaces');
  configureSecrets(rootDir);
  const workspaces = new Workspaces({ dataDir, rootDir, packsDir });
  try {
    for (const { id } of await workspaces.list()) {
      const ws = await workspaces.get(id);
      const { rows } = await ws.pelago.db.query<{ items: number; facts: number; pictures: number }>(
        `select (select count(*)::int from entity) as items, (select count(*)::int from log_fact) as facts, (select count(*)::int from picture) as pictures`,
      );
      const folder = id === 'default' ? dataDir : join(rootDir, id, 'db');
      console.log(`storage ${id}: ${bytes(await storageBytes(ws.pelago.db))} of log and pictures (${rows[0].items} items, ${rows[0].facts} facts, ${rows[0].pictures} pictures); folder ${mb(folderSize(folder))}`);
    }
  } finally {
    await workspaces.closeAll();
  }
}

/** The newest backup `npm run pull` kept beside a data folder, with its keys. */
function pulled(dataDir: string): Dump {
  const dir = join(dataDir, '..', 'backups', 'pulled');
  const file = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json.gz') && !f.endsWith('.vault.json.gz')).sort().at(-1) : undefined;
  if (!file) throw new Error(`No backup in ${dir}: make the copy with npm run pull, which keeps one there.`);
  const backup = parseBackup(readFileSync(join(dir, file)));
  const vault = join(dir, file.replace('.json.gz', '.vault.json.gz'));
  if (existsSync(vault)) backup.vault = readVault(vault);
  return backup;
}

/** The process's memory with N copies of the map open at once, and the rate one copy answers a busy session's requests. */
async function openMany(dataDir: string, n: number, seconds: number, databaseUrl?: string) {
  const scratch = mkdtempSync(join(tmpdir(), 'pelago-measure-'));
  const rootDir = join(scratch, 'workspaces');
  const made: string[] = [];
  let workspaces: Workspaces | undefined;
  try {
    // The pulled copy's keys were wrapped under the key kept beside its data folder: it is taken along.
    cpSync(join(dataDir, '..', 'workspaces'), rootDir, { recursive: true, filter: (src) => !/[\\/]workspaces[\\/][^\\/]+[\\/]db([\\/]|$)/.test(src) });
    configureSecrets(rootDir, !databaseUrl);
    const backup = pulled(dataDir);
    workspaces = new Workspaces({ dataDir: join(scratch, 'data'), rootDir, packsDir, ...(databaseUrl && { databaseUrl }) });
    await workspaces.get('default');
    const base = rss();
    console.log(`memory: ${mb(base)} with the empty default workspace open`);
    // A new workspace, empty but for what its packs make: what a workspace costs before its map does.
    for (let i = 1; i <= 2; i++) made.push((await workspaces.create(`measure-empty-${i}`, `Empty ${i}`)).id);
    const first = rss();
    console.log(`memory: ${mb(first)} with two new empty workspaces open too (+${mb((first - base) / 2)} each)`);
    let last = first;
    for (let i = 1; i <= n; i++) {
      made.push((await workspaces.create(`measure-copy-${i}`, `Copy ${i}`, structuredClone(backup))).id);
      const now = rss();
      console.log(`memory: ${mb(now)} with ${i} cop${i === 1 ? 'y' : 'ies'} open (+${mb(now - last)})`);
      last = now;
    }
    console.log(`memory: ${mb((last - first) / Math.max(n, 1))} a copy on average`);

    const server = createHttpServer(workspaces, 0, { auth: 'tokens' });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    // The server checks the Host header against the port it was made for: made again, now the port is known.
    server.close();
    const live = createHttpServer(workspaces, port, { auth: 'tokens', limits: { token: { each: Number.MAX_SAFE_INTEGER } } });
    await new Promise<void>((r) => live.listen(port, '127.0.0.1', r));
    const ws = await workspaces.get(made.at(-1)!);
    const token = (await createToken(ws.pelago.db, ws.id, { kind: 'agent', name: 'measure' })).token;
    const ask = (tool: string, body: unknown) =>
      fetch(`http://127.0.0.1:${port}/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then((r) => r.json());
    // A busy session's mix: mostly reads (search, get, a view), now and then a write.
    const { result: found } = (await ask('query', { name: 'search', params: { q: 'limit', limit: 20 } })) as { result: { id: string }[] };
    const ids = (Array.isArray(found) ? found : []).map((e) => e.id);
    const mix = [
      () => ask('query', { name: 'search', params: { q: 'plan', limit: 20 } }),
      () => ask('query', { name: 'get', params: { id: ids[Math.floor(Math.random() * ids.length)] ?? 'e_none' } }),
      () => ask('query', { name: 'attention', params: { person: 'me' } }),
      () => ask('change', { reason: 'measure', ops: [{ op: 'create', type: 'task', title: `Measured ${Date.now()}` }] }),
    ];
    const end = Date.now() + seconds * 1000;
    const times: number[] = [];
    for (let i = 0; Date.now() < end; i++) {
      const t = performance.now();
      await mix[i % 10 === 9 ? 3 : i % 3]();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    console.log(`requests: ${Math.round((times.length / seconds) * 60)} a minute answered one at a time (median ${times[times.length >> 1].toFixed(0)} ms, p95 ${times[Math.floor(times.length * 0.95)].toFixed(0)} ms); memory then ${mb(rss())}`);
    live.close();
  } finally {
    // On a Postgres server the databases made here are dropped; in a scratch folder the folder goes.
    if (databaseUrl) for (const id of made) await workspaces?.delete(id).catch((err: Error) => console.error(`left ${id}: ${err.message}`));
    await workspaces?.closeAll();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The pelago tool calls a minute of each Claude Code session in the last `days`, from its session file. */
function sessionRates(folder: string, days: number) {
  const since = Date.now() - days * 86_400_000;
  const files = readdirSync(folder, { recursive: true, withFileTypes: true }).filter((f) => f.isFile() && f.name.endsWith('.jsonl')).map((f) => join(f.parentPath, f.name)).filter((f) => statSync(f).mtimeMs >= since);
  const peaks: number[] = [], averages: number[] = [];
  for (const file of files) {
    const minutes = new Map<number, number>();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('mcp__pelago')) continue;
      try {
        const row = JSON.parse(line) as { timestamp?: string; message?: { content?: { type: string; name?: string }[] } };
        const calls = (Array.isArray(row.message?.content) ? row.message.content : []).filter((c) => c.type === 'tool_use' && c.name?.startsWith('mcp__pelago')).length;
        if (calls && row.timestamp) minutes.set(Math.floor(Date.parse(row.timestamp) / 60_000), (minutes.get(Math.floor(Date.parse(row.timestamp) / 60_000)) ?? 0) + calls);
      } catch {}
    }
    if (minutes.size < 3) continue;
    const counts = [...minutes.values()];
    peaks.push(Math.max(...counts));
    averages.push(counts.reduce((a, b) => a + b, 0) / counts.length);
  }
  peaks.sort((a, b) => a - b);
  averages.sort((a, b) => a - b);
  const at = (list: number[], q: number) => list[Math.min(list.length - 1, Math.floor(list.length * q))] ?? 0;
  console.log(`sessions: ${peaks.length} in ${days} days that called pelago in 3 minutes or more; calls in a busy minute: median ${at(peaks, 0.5)}, p95 ${at(peaks, 0.95)}, most ${peaks.at(-1) ?? 0}; in a minute it called at all: median ${at(averages, 0.5).toFixed(1)}`);
}

if (opt.data) {
  await storage(opt.data);
  await openMany(opt.data, Number(opt.open), Number(opt.seconds), opt['database-url']);
}
if (opt.transcripts !== undefined) sessionRates(opt.transcripts || join(homedir(), '.claude', 'projects'), Number(opt.days));
if (!opt.data && opt.transcripts === undefined) console.log('Give --data <a copied data folder>, --transcripts [folder], or both.');
