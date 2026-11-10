// A server with no sealing key (staging: a Postgres server copied from live, without PELAGO_SECRETS_KEY) opens a
// workspace whose packs changed since its log was written, and leaves the log as it was: it crashed on 10 Nov 2026.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { configureSecrets } from '../src/secrets.ts';
import { Workspaces } from '../src/workspaces.ts';
import { packsWith } from './map.ts';

const packFacts = async (l: { db: { query: <T>(sql: string) => Promise<{ rows: T[] }> } }) =>
  (await l.db.query<{ n: number }>(`select count(*)::int as n from log_fact where stream = 'facts' and field = 'pack'`)).rows[0].n;

test('a server with no sealing key opens a workspace whose packs changed, and writes nothing to its log', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-keyless-'));
  const packsDir = packsWith();
  const config = { rootDir: join(root, 'workspaces'), dataDir: join(root, 'data'), packsDir };
  configureSecrets(join(root, 'keyed')); // the server the log was written on, with a key
  try {
    const one = new Workspaces(config);
    const said = await packFacts((await one.get('default')).pelago);
    assert.ok(said > 0, 'the packs are facts on the log');
    await one.closeAll();

    // The packs move on, and the next server has no key and may make none (one on Postgres).
    const core = join(packsDir, 'core', 'pack.json');
    writeFileSync(core, JSON.stringify({ ...JSON.parse(readFileSync(core, 'utf8')), version: '99.0.0' }, null, 2));
    configureSecrets(join(root, 'keyless'), false);
    const two = new Workspaces(config);
    const { pelago: l } = await two.get('default');
    assert.equal(l.registry.packs.find((p) => p.id === 'core')?.version, '99.0.0', 'it runs the packs it has');
    assert.equal(await packFacts(l), said, 'and the log is as it was');
    await two.closeAll();

    // A server with a key again brings the log in line, as it always did.
    configureSecrets(join(root, 'keyed'));
    const three = new Workspaces(config);
    assert.equal(await packFacts((await three.get('default')).pelago), said + 1);
    await three.closeAll();
  } finally {
    configureSecrets(null);
  }
});
