// What the server keeps about itself is in its database, not beside it: which workspaces there are, the operator's
// secret, what server packs keep and which workspaces connected each, and the types each workspace defined for itself.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { readEnded, setEnded } from '../src/ended.ts';
import { hashSecret } from '../src/auth.ts';
import { ADOPT_APP, setControlValue, storeGet } from '../src/control.ts';
import { seal } from '../src/secrets.ts';
import { connectionById, dropConnections } from '../src/server-connect.ts';
import { serverSecret } from '../src/server-requests.ts';
import { Workspaces } from '../src/workspaces.ts';
import { human } from './map.ts';

const SITE_VISIT = { id: 'local.site_visit', title: 'Site visit', description: 'A visit to a site.', extends: 'event' };
const define = (ws: Awaited<ReturnType<Workspaces['get']>>, type: Record<string, unknown>) => ws.pelago.change(human, { reason: 'test', ops: [{ op: 'define_type', type } as never] });

function setUp() {
  const root = mkdtempSync(join(tmpdir(), 'pelago-control-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), join(root, 'packs'), { recursive: true });
  rmSync(join(root, 'packs', 'local'), { recursive: true, force: true });
  return { root, config: { dataDir: join(root, 'data'), rootDir: join(root, 'workspaces'), packsDir: join(root, 'packs') } };
}

test('what the files beside the data held is taken into the database, and kept there without them', async () => {
  const { root, config } = setUp();
  const operator = 'latop_' + 'o'.repeat(40);
  mkdirSync(config.rootDir, { recursive: true });
  writeFileSync(join(config.rootDir, 'index.json'), JSON.stringify({ operator: hashSecret(operator), workspaces: [{ id: 'acme', name: 'Acme', created: '2026-10-01T00:00:00.000Z' }] }));
  mkdirSync(join(config.packsDir, 'local'));
  writeFileSync(join(config.packsDir, 'local', 'pack.json'), JSON.stringify({ id: 'local', version: '0.1.0', title: 'Local', types: [SITE_VISIT] }));

  const one = new Workspaces(config);
  assert.deepEqual((await one.list()).map((w) => w.id), ['default', 'acme']);
  assert.equal(await one.isOperator(operator), true);
  assert.ok((await one.get('default')).pelago.registry.type('local.site_visit'), 'the default workspace’s own types, from the checkout');
  // What the GitHub App kept when it was the kernel's is its server pack's after step 13 of the schema: run again here
  // over what a server kept then, its key sealed and its installation tied to a workspace.
  const control = await one.control();
  await setControlValue(control, 'github_app', { id: 7, slug: 'pelago-x', name: 'X', pem: seal('PEM'), webhook_secret: seal('whsec') });
  await control.query(`insert into github_installation (id, workspace, account) values ('42', 'acme', 'Acme')`);
  await control.exec(ADOPT_APP);
  const app = { id: 'github_app', reach: { secrets: [{ name: 'key' }, { name: 'hook' }, { name: 'app_id' }], server: {} } };
  assert.deepEqual(await connectionById(control, 'github_app', '42'), { id: '42', workspace: 'acme', account: 'Acme' });
  assert.deepEqual([await serverSecret(control, app, 'key'), await serverSecret(control, app, 'hook'), await serverSecret(control, app, 'app_id')], ['PEM', 'whsec', '7']);
  assert.deepEqual(await storeGet(control, 'github_app', 'app'), { id: 7, slug: 'pelago-x', name: 'X' });

  await define(await one.get('acme'), { ...SITE_VISIT, id: 'local.audit' });
  assert.equal(existsSync(join(config.rootDir, 'acme', 'local-pack')), false, 'a type defined now is written to no folder');
  await one.closeAll();

  // The files go; nothing is lost.
  rmSync(join(config.rootDir, 'index.json'));
  rmSync(join(config.packsDir, 'local'), { recursive: true });
  const two = new Workspaces(config);
  assert.deepEqual((await two.list()).map((w) => w.id), ['default', 'acme']);
  assert.equal(await two.isOperator(operator), true);
  assert.ok((await two.get('acme')).pelago.registry.type('local.audit'));
  assert.ok((await two.get('default')).pelago.registry.type('local.site_visit'));
  assert.equal((await two.get('acme')).pelago.registry.type('local.site_visit'), undefined, 'one workspace’s types are not another’s');
  assert.equal((await connectionById(await two.control(), 'github_app', '42'))?.workspace, 'acme');
  await dropConnections(await two.control(), 'github_app', { id: '42' });
  assert.equal(await connectionById(await two.control(), 'github_app', '42'), undefined, 'forgotten');
  await two.closeAll();
  rmSync(root, { recursive: true, force: true });
});

test('the operator secret is made once, and a reset prepared in the database is good for one try', async () => {
  const { root, config } = setUp();
  const w = new Workspaces({ ...config, dataDir: null });
  const first = await w.ensureOperator();
  assert.ok(first);
  assert.equal(await w.ensureOperator(), undefined);
  const { OPERATOR_RESET, setControlValue } = await import('../src/control.ts');
  const proof = 'reset_' + 'p'.repeat(48);
  await setControlValue(await w.control(), OPERATOR_RESET, hashSecret(proof));
  assert.equal(await w.resetOperator('reset_' + 'q'.repeat(48)), undefined, 'a wrong proof');
  assert.equal(await w.resetOperator(proof), undefined, 'and the reset is spent');
  await setControlValue(await w.control(), OPERATOR_RESET, hashSecret(proof));
  const fresh = await w.resetOperator(proof);
  assert.ok(fresh);
  assert.equal(await w.isOperator(first), false);
  assert.equal(await w.isOperator(fresh), true);
  await w.closeAll();
  rmSync(root, { recursive: true, force: true });
});

const server = process.env.PELAGO_TEST_DATABASE_URL;

test('two servers on one database agree on the workspaces and on the types defined in them', { skip: !server && 'needs PELAGO_TEST_DATABASE_URL' }, async () => {
  const { root, config } = setUp();
  const name = `pelago_c_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: server });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const databaseUrl = Object.assign(new URL(server!), { pathname: `/${name}` }).toString();
  const a = new Workspaces({ ...config, databaseUrl });
  const b = new Workspaces({ ...config, databaseUrl });
  try {
    assert.equal(await b.has('acme'), false);
    await a.create('acme', 'Acme');
    assert.equal(await b.has('acme'), true, 'made on one server, known on the other');
    assert.deepEqual((await b.list()).map((w) => w.id), ['default', 'acme']);
    await assert.rejects(b.create('acme', 'Again'), /already exists/);

    const there = await b.get('acme');
    await define(await a.get('acme'), SITE_VISIT);
    assert.equal(there.pelago.registry.type('local.site_visit'), undefined, 'not looked yet');
    await b.follow();
    assert.ok(there.pelago.registry.type('local.site_visit'), 'defined on one server, followed by the other');
  } finally {
    await a.closeAll();
    await b.closeAll();
    for (const db of [name, `${name}_acme`]) await admin.query(`drop database if exists ${db} with (force)`);
    await admin.end();
    rmSync(root, { recursive: true, force: true });
  }
});

test('an ended workspace whose day has come is deleted from Postgres, its database dropped, while another server has it open', { skip: !server && 'needs PELAGO_TEST_DATABASE_URL' }, async () => {
  const { root, config } = setUp();
  const name = `pelago_d_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: server });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const databaseUrl = Object.assign(new URL(server!), { pathname: `/${name}` }).toString();
  const a = new Workspaces({ ...config, databaseUrl });
  const b = new Workspaces({ ...config, databaseUrl });
  const exists = async (db: string) => (await admin.query(`select 1 from pg_database where datname = $1`, [db])).rows.length > 0;
  try {
    await a.create('acme', 'Acme');
    await (await b.get('acme')).pelago.db.query('select 1');
    assert.equal(await exists(`${name}_acme`), true);
    const control = (await a.get('default')).pelago.db;
    await setEnded(control, 'acme', { since: new Date().toISOString(), delete_at: new Date(Date.now() + 86_400_000).toISOString() });
    assert.deepEqual(await a.deleteDue(), [], 'not before its day');
    assert.deepEqual(await a.deleteDue(new Date(Date.now() + 2 * 86_400_000)), ['acme']);
    assert.equal(await exists(`${name}_acme`), false, 'its database is dropped');
    assert.equal(await a.has('acme'), false);
    assert.deepEqual((await b.list()).map((w) => w.id), ['default'], 'gone for the other server too');
    assert.equal(await readEnded(control, 'acme'), undefined);
  } finally {
    await a.closeAll();
    await b.closeAll().catch(() => {});
    for (const db of [name, `${name}_acme`]) await admin.query(`drop database if exists ${db} with (force)`);
    await admin.end();
    rmSync(root, { recursive: true, force: true });
  }
});
