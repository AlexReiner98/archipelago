// Which map `npm run pull -- <name>` copies: the MCP server of that name, as Claude Code reaches it from here. And what
// it copies: the whole map an agent's backup holds, made a data folder that opens as the map did, with no link left
// hanging. In a file of its own: it moves the sealing key to a folder, as a server keeps it.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { agent, fresh, human, make } from './map.ts';
import { parseBackup, parseVault } from '../src/backup.ts';
import { takeBackup } from '../src/backup-tools.ts';
import { openDb } from '../src/db.ts';
import { configureOutbox } from '../src/outbox.ts';
import { Archipelago } from '../src/pelago.ts';
import { connection, takeIn, takePulled } from '../src/pull.ts';
import { configureSecrets } from '../src/secrets.ts';
import { hashOf } from '../src/snapshot.ts';
import { callTool } from '../src/tools.ts';
import { keysOf } from '../src/vault.ts';

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
  const kind = whole.registry.type('task')?.kind ?? null;
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
