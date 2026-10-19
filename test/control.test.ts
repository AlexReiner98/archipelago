// What the server keeps about itself is in its database, not beside it: which workspaces there are, the operator's
// secret, the GitHub App and its installations, and the types each workspace defined for itself.
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { hashSecret } from '../src/auth.ts';
import { controlValue, GITHUB_APP } from '../src/control.ts';
import { GithubApp } from '../src/github-app.ts';
import { isSealed } from '../src/secrets.ts';
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
  writeFileSync(join(config.rootDir, 'github-app.json'), JSON.stringify({ app: { id: 7, slug: 'pelago-x', name: 'X', pem: 'PEM', webhook_secret: 'whsec' }, installations: { '42': { workspace: 'acme', account: 'Acme' } } }));
  mkdirSync(join(config.packsDir, 'local'));
  writeFileSync(join(config.packsDir, 'local', 'pack.json'), JSON.stringify({ id: 'local', version: '0.1.0', title: 'Local', types: [SITE_VISIT] }));

  const one = new Workspaces(config);
  assert.deepEqual((await one.list()).map((w) => w.id), ['default', 'acme']);
  assert.equal(await one.isOperator(operator), true);
  assert.ok((await one.get('default')).pelago.registry.type('local.site_visit'), 'the default workspace’s own types, from the checkout');
  const app = new GithubApp({ control: () => one.control(), origin: 'https://map.test' });
  assert.equal(await app.workspaceOf(42), 'acme');
  assert.deepEqual(await app.app(), { slug: 'pelago-x', name: 'X' });
  const body = Buffer.from('{}');
  assert.equal(await app.signed(body, `sha256=${createHmac('sha256', 'whsec').update(body).digest('hex')}`), true);
  const kept = await controlValue<{ pem: string; webhook_secret: string }>(await one.control(), GITHUB_APP);
  assert.ok(isSealed(kept!.pem) && isSealed(kept!.webhook_secret), 'the key brought from the file is sealed in the database');

  await define(await one.get('acme'), { ...SITE_VISIT, id: 'local.audit' });
  assert.equal(existsSync(join(config.rootDir, 'acme', 'local-pack')), false, 'a type defined now is written to no folder');
  await one.closeAll();

  // The files go; nothing is lost.
  for (const file of ['index.json', 'github-app.json']) rmSync(join(config.rootDir, file));
  rmSync(join(config.packsDir, 'local'), { recursive: true });
  const two = new Workspaces(config);
  assert.deepEqual((await two.list()).map((w) => w.id), ['default', 'acme']);
  assert.equal(await two.isOperator(operator), true);
  assert.ok((await two.get('acme')).pelago.registry.type('local.audit'));
  assert.ok((await two.get('default')).pelago.registry.type('local.site_visit'));
  assert.equal((await two.get('acme')).pelago.registry.type('local.site_visit'), undefined, 'one workspace’s types are not another’s');
  const again = new GithubApp({ control: () => two.control(), origin: 'https://map.test' });
  assert.equal(await again.workspaceOf('42'), 'acme');
  await new GithubApp({ control: () => two.control(), origin: 'https://map.test' }).forget(42);
  assert.equal(await again.workspaceOf('42'), undefined, 'forgotten by one, gone for the other');
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
