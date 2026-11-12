// Which map `npm run pull -- <name>` copies: the MCP server of that name, as Claude Code reaches it from here. And what
// it copies: the whole map an agent's backup holds, made a data folder that opens as the map did, with no link left
// hanging. In a file of its own: it moves the sealing key to a folder, as a server keeps it.

import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import test, { mock } from 'node:test';
import { agent, fresh, human, make } from './map.ts';
import { parseBackup, parseVault } from '../packs/log/kernel/backup.ts';
import { takeBackup } from '../packs/surface/kernel/backup-tools.ts';
import { openDb } from '../packs/database/kernel/db.ts';
import { configureOutbox } from '../packs/identity/kernel/outbox.ts';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { connection, held, putInPlace, sameFolder, takeIn, takePulled } from '../scripts/pull.ts';
import { configureSecrets } from '../packs/seal/kernel/secrets.ts';
import { hashOf } from '../packs/log/kernel/snapshot.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { keysOf } from '../packs/seal/kernel/vault.ts';

test('a named map is found from a folder under its project, nearest first, with its token read from the environment', () => {
  const home = mkdtempSync(join(tmpdir(), 'pelago-pull-'));
  const repo = join(home, 'repo'), tree = join(repo, '.claude', 'worktrees', 'one');
  mkdirSync(tree, { recursive: true });
  const server = (url: string, auth: string) => ({ type: 'http', url, headers: { Authorization: auth } });
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: { site: server('https://wrong.example/mcp', 'Bearer user') },
      projects: {
        [home.replaceAll('\\', '/')]: { mcpServers: { site: server('https://outer.example/mcp', 'Bearer outer') } },
        [repo]: { mcpServers: { site: server('https://site.example/mcp', 'Bearer ${SITE_TOKEN:-none}') } },
      },
    }),
  );
  assert.deepEqual(connection('site', tree, home, { SITE_TOKEN: 'secret' }), { url: 'https://site.example', token: 'secret' });
  assert.deepEqual(connection('site', tree, home, {}), { url: 'https://site.example', token: 'none' });
  assert.deepEqual(connection('site', home, home, {}), { url: 'https://outer.example', token: 'outer' });
  // A project's .mcp.json comes before them all; a name nobody has is no map.
  writeFileSync(join(tree, '.mcp.json'), JSON.stringify({ mcpServers: { site: server('https://here.example/mcp/', 'Bearer here') } }));
  assert.deepEqual(connection('site', tree, home, {}), { url: 'https://here.example', token: 'here' });
  assert.equal(connection('other', tree, home, {}), undefined);
});

test("an agent's backup is pulled whole: private items, items from before the log, every link, its keys open after", async () => {
  const whole = await fresh();
  configureOutbox(async () => whole);
  const me = (await make(whole, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }])).me;
  const owner = whole.as(me, true);
  // An item from before the log: a row the log never said, as every item on the live map made before 24 Oct 2026 is.
  const kind = whole.registry.type('task')?.starter ?? null;
  await whole.db.query(`insert into entity (id, type, kind, title, status, is_open, visibility) values ('e_beforelog', 'task', $1, 'From before the log', 'todo', true, 'shared')`, [kind]);
  const mine = (await owner.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'h', type: 'task', title: 'Only mine', visibility: 'private' }] })) as { created: Record<string, string> };
  const made = await make(whole, [
    { op: 'create', ref: 't', type: 'task', title: 'Shared' },
    { op: 'link', type: 'depends_on', from: 't', to: mine.created.h },
    { op: 'link', type: 'depends_on', from: 't', to: 'e_beforelog' },
  ]);
  await callTool(owner, { ...human, admin: true }, 'workspace_set', { agent_backups: true });
  const answer = (await callTool(whole.as('e_agentx'), agent, 'backup_download', {})) as { path: string; vault_path: string; vault_key: string };
  const got = async (path: string) => (await takeBackup(whole.db, path.split('/').at(-1)!))!.file;
  const file = await got(answer.path), vault = parseVault(await got(answer.vault_path)), key = Buffer.from(answer.vault_key, 'base64url');
  const counted = async (db: { query: Archipelago['db']['query'] }, sql: string) => (await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0].n;
  const items = await counted(whole.db, 'entity'), links = await counted(whole.db, 'relation');

  // As this code reads its snapshot, and as code whose projector has moved on does: the snapshot is the map either way.
  const otherCode = (backup: ReturnType<typeof parseBackup>) => {
    const s = backup.snapshot as Record<string, any>;
    s.code = '0123456789abcdef';
    const head = { v: 1 as const, ws: whole.workspace, projection: s.projection, projection_version: s.projection_version, code: s.code, positions: s.positions, fact_hash: s.fact_hash, taken_at: new Date(s.taken_at).toISOString() };
    s.hash = hashOf(head, gunzipSync(Buffer.from(s.rows, 'base64')));
    return backup;
  };
  for (const backup of [parseBackup(file), otherCode(parseBackup(file))]) {
    const dir = mkdtempSync(join(tmpdir(), 'pelago-pull-'));
    try {
      const dataDir = join(dir, 'data');
      const { counts } = await takeIn(dataDir, backup, { vault, key });
      assert.deepEqual([counts.entity, counts.relation], [items, links], 'every item and every link');
      takePulled(dataDir);
      // A server started later on the folder: the sealing key as it keeps it, read again from its file.
      configureSecrets(join(dataDir, '..', 'workspaces'));
      const there = new Archipelago(await openDb(dataDir), whole.registry);
      const titles = (await there.db.query<{ title: string }>(`select title from entity order by title`)).rows.map((r) => r.title);
      assert.ok(['From before the log', 'Only mine', 'Shared'].every((t) => titles.includes(t)), 'in clear');
      assert.equal(await counted(there.db, `relation r where not exists (select 1 from entity where id = r.from_id) or not exists (select 1 from entity where id = r.to_id)`), 0, 'no link hangs');
      assert.equal((await keysOf(there.db, [mine.created.h, made.t])).size, 2, 'its keys open under the sealing key of the server on the folder');
      await there.change(human, { reason: 'test', ops: [{ op: 'update', id: mine.created.h, title: 'Still mine' }] });
      await there.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      configureSecrets(null);
    }
  }
});

test('a pull restarts only a server on its own data folder, and the lock says whether another holds it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-pull-'));
  const dataDir = join(dir, 'data');
  assert.ok(sameFolder(join(dir, '.', 'data'), dataDir));
  assert.ok(!sameFolder(join(dir, 'other'), dataDir), "another worktree's server");
  assert.ok(!sameFolder(undefined, dataDir), 'a server that does not say its folder');
  assert.ok(!held(dataDir));
  writeFileSync(`${dataDir}.lock`, `${process.pid}@${hostname()}`);
  assert.ok(held(dataDir));
  rmSync(dir, { recursive: true, force: true });
});

test('a copy that cannot be moved in, as when a second pull is replacing it, leaves the data folder as it was', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-pull-'));
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  writeFileSync(join(dataDir, 'mine'), 'kept');
  mkdirSync(`${dataDir}.pulled`);
  const real = fs.renameSync;
  mock.method(fs, 'renameSync', (from: string, to: string) => {
    if (from === `${dataDir}.pulled`) throw Object.assign(new Error('EBUSY: in use'), { code: 'EBUSY' });
    real(from, to);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => takePulled(dataDir), /EBUSY/);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(readFileSync(join(dataDir, 'mine'), 'utf8'), 'kept');
  assert.deepEqual(readdirSync(dir).sort(), ['data', 'data.pulled']);
  rmSync(dir, { recursive: true, force: true });
});

test("a pull leaves another folder's server on the port alone, and restarts only its own", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-pull-'));
  const dataDir = join(dir, 'data');
  let serving = join(dir, 'other', 'data'), restarts = 0, started = 'one';
  const server = createServer((req, res) => {
    if (req.url === '/agent/revise') (restarts++, (started = 'two'), fs.renameSync(`${dataDir}.pulled`, dataDir));
    res.end(JSON.stringify({ started, data: serving }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  try {
    // Another worktree's server on the port, and none on this folder: the copy goes in at once, and that server is not asked.
    mkdirSync(`${dataDir}.pulled`);
    assert.match(await putInPlace(dataDir, port), /^In place/);
    assert.equal(restarts, 0);
    // Another server holds this folder on another port: the copy waits for it.
    mkdirSync(`${dataDir}.pulled`);
    writeFileSync(`${dataDir}.lock`, `${process.pid}@${hostname()}`);
    assert.match(await putInPlace(dataDir, port), /waits in/);
    assert.equal(restarts, 0);
    // This folder's own server: asked to restart, and it takes the copy.
    rmSync(dataDir, { recursive: true, force: true });
    serving = dataDir;
    assert.match(await putInPlace(dataDir, port), /restarted on the pulled map/);
    assert.equal(restarts, 1);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
