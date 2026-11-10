import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createToken, verifyToken } from '../src/auth.ts';
import { openDb, type Database } from '../src/db.ts';
import { LATEST, MIGRATIONS, versionOf } from '../src/migrate.ts';

const folder = () => mkdtempSync(join(tmpdir(), 'pelago-migrate-'));
const steps = async (db: Database) => (await db.query<{ version: number; applied_at: Date }>(`select version, applied_at from schema_version order by version`)).rows;

test('a new database has every step, each recorded once', async () => {
  const db = await openDb(folder());
  assert.deepEqual((await steps(db)).map((s) => s.version), MIGRATIONS.map((m) => m.version));
  assert.equal(await versionOf(db), LATEST);
  await db.close();
});

test('a database from before browser sign-in gets its column on opening, and its tokens still work', async () => {
  const dir = folder();
  const made = await openDb(dir);
  await made.exec(`alter table token drop column granted; delete from schema_version where version >= 29;`);
  await made.close();
  const db = await openDb(dir);
  assert.equal(await versionOf(db), LATEST);
  const made2 = await createToken(db, 'default', { kind: 'agent', name: 'old' });
  assert.equal((await verifyToken(db, made2.token))?.actor.name, 'old');
  await db.close();
});

test('a step recorded without its table is run again on opening, and members can be listed', async () => {
  const dir = folder();
  const made = await openDb(dir);
  await made.exec(`drop table member`);
  await made.close();
  const db = await openDb(dir);
  assert.equal((await db.query(`select count(*)::int as n from member`)).rows.length, 1);
  assert.equal((await steps(db)).filter((s) => s.version === 6).length, 1);
  await db.close();
});

test('opening a database that has every step applies none again', async () => {
  const dir = folder();
  const first = await openDb(dir);
  const before = await steps(first);
  await first.close();
  const db = await openDb(dir);
  assert.deepEqual(await steps(db), before);
  await db.close();
});

test('a database made before steps were numbered takes the first over what it has, and keeps it', async () => {
  const dir = folder();
  const made = await openDb(dir);
  await made.exec(`drop table schema_version; insert into entity (id, type, title, status, is_open) values ('e_kept0000', 'task', 'Kept', 'todo', true)`);
  await made.close();
  const db = await openDb(dir);
  assert.equal(await versionOf(db), LATEST);
  assert.equal((await db.query(`select 1 from entity where id = 'e_kept0000'`)).rows.length, 1);
  await db.close();
});

test('the old app opens a database the new one has moved ahead', async () => {
  const dir = folder();
  const made = await openDb(dir);
  await made.exec(`insert into schema_version (version, name) values (${LATEST + 1}, 'from a later release')`);
  await made.close();
  const db = await openDb(dir);
  assert.equal(await versionOf(db), LATEST + 1);
  await db.close();
});

test('a step that fails leaves nothing of itself and no record, and says which it was', async () => {
  const dir = folder();
  await (await openDb(dir)).close();
  MIGRATIONS.push({ version: LATEST + 1, name: 'half done', sql: `create table half (id int); select no_such_function();` });
  try {
    await assert.rejects(openDb(dir), (err: Error) => err.message.startsWith(`Migration ${LATEST + 1} (half done) failed`));
  } finally {
    MIGRATIONS.pop();
  }
  const db = await openDb(dir);
  assert.equal(await versionOf(db), LATEST);
  assert.equal((await db.query<{ t: string | null }>(`select to_regclass('half')::text as t`)).rows[0].t, null);
  await db.close();
});

test('step 27 drops the activity written before the log began, and keeps the rest', async () => {
  const { fresh, make } = await import('./map.ts');
  const { PRE_LOG_ACTIVITY } = await import('../src/activity-steps.ts');
  const l = await fresh();
  await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'After the log began' }]);
  // The event table as it stood then: step 34 has dropped it since.
  await l.db.query(`create table event (seq bigint primary key default nextval('event_seq_seq'), actor text not null, action text not null, target_id text, changeset text, reason text not null default '', detail jsonb not null default '{}')`);
  const add = (seq: number | null, action: string) =>
    l.db.query(`insert into event (${seq === null ? '' : 'seq, '}actor, action, reason, detail) values (${seq === null ? '' : `${seq}, `}'human:test', $1, 'test', '{}')`, [action]);
  // Numbered before the log's first fact, as a map's rows were before it had a log.
  await add(-3, 'entity.update');
  await add(-2, 'relation.link');
  await add(-1, 'session.start');
  // Brought in since, as a merged backup's change sets are.
  await add(null, 'entity.update');
  await l.db.query(PRE_LOG_ACTIVITY);
  const { rows } = await l.db.query<{ seq: string; action: string }>(`select seq, action from event where reason = 'test' order by seq`);
  assert.deepEqual(rows.map((r) => [Number(r.seq) < 0, r.action]), [[true, 'session.start'], [false, 'entity.update']]);
});

test('a folder keeps a small write-ahead log', async () => {
  const dir = folder();
  const db = await openDb(dir);
  assert.deepEqual((await db.query<{ min: string; max: string }>(`select current_setting('min_wal_size') as min, current_setting('max_wal_size') as max`)).rows[0], { min: '32MB', max: '64MB' });
  await db.close();
});

test('a database from before any-word search gets its function on opening', async () => {
  const dir = folder();
  const made = await openDb(dir);
  await made.exec(`drop function pelago_search_any(text); delete from schema_version where version >= 30;`);
  await made.close();
  const db = await openDb(dir);
  assert.equal(await versionOf(db), LATEST);
  assert.deepEqual((await db.query(`select * from pelago_search_any('nothing here')`)).rows, []);
  await db.close();
});

test('step 39 drops shares made out to a workspace, keeps the links, and a backup from before still restores', async () => {
  const { WORKSPACE_SHARE } = await import('../src/schema.ts');
  const { SHARE_PUBLISHABLE } = await import('../src/public-schema.ts');
  const { dump, restore } = await import('../src/backup.ts');
  const dir = folder();
  const made = await openDb(dir);
  // The map as it stood at step 38: a share may be made out to a workspace, and published there.
  await made.exec(`${WORKSPACE_SHARE}\n${SHARE_PUBLISHABLE}\ndelete from schema_version where version >= 39;`);
  await made.exec(`insert into entity (id, type, title, status, is_open) values ('e_doc00000', 'task', 'A page', 'todo', true)`);
  await made.exec(`insert into share (id, hash, hint, entity_id, made_by) values ('s_link0000', 'h1', 'a link', 'e_doc00000', 'alex')`);
  await made.exec(`insert into share (id, hint, entity_id, made_by, to_workspace, to_item, publishable) values ('s_ws000000', 'acme', 'e_doc00000', 'alex', 'acme', 'e_there000', true)`);
  const { dumpVault } = await import('../src/vault.ts');
  const before = { ...(await dump(made, { id: 'default', name: 'Default' })), vault: await dumpVault(made) };
  await made.close();

  // Opened by this release: the step runs once.
  const db = await openDb(dir);
  assert.equal(await versionOf(db), LATEST);
  assert.deepEqual((await db.query<{ id: string }>(`select id from share order by id`)).rows.map((r) => r.id), ['s_link0000'], 'the link stays; the share made out to a workspace goes');
  const columns = (await db.query<{ c: string }>(`select column_name as c from information_schema.columns where table_name = 'share'`)).rows.map((r) => r.c);
  assert.ok(!columns.some((c) => ['to_workspace', 'to_item', 'publishable'].includes(c)), `its columns are gone: ${columns.join(', ')}`);
  const fns = (await db.query<{ n: string }>(`select proname as n from pg_proc where proname like 'pelago_workspace_%'`)).rows;
  assert.deepEqual(fns, [], 'and the functions only they read');
  assert.equal((await db.query(`select 1 from entity where id = 'e_doc00000'`)).rows.length, 1, 'the item is untouched');
  await db.close();

  // A backup taken before the step restores into a database past it: the dropped columns are not read.
  const into = await openDb(folder());
  await restore(into, before);
  assert.equal((await into.query(`select 1 from entity where id = 'e_doc00000'`)).rows.length, 1);
  assert.ok((await into.query<{ id: string }>(`select id from share`)).rows.some((r) => r.id === 's_link0000'), 'its link restores');
  await into.close();
});
