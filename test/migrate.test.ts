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
  const { PRE_LOG_ACTIVITY } = await import('../src/eventlog.ts');
  const l = await fresh();
  await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'After the log began' }]);
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
