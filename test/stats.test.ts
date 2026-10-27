import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { dump, restoreTo } from '../src/backup.ts';
import { dumpVault } from '../src/vault.ts';
import { openDb, type Q } from '../src/db.ts';
import { Archipelago } from '../src/pelago.ts';
import { analyzeDue } from '../src/stats.ts';
import { fresh, human } from './map.ts';

const folders: string[] = [];
const folder = () => folders[folders.push(mkdtempSync(join(tmpdir(), 'pelago-stats-'))) - 1];
after(() => folders.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const analysed = async (db: Q, table: string) => (await db.query<{ n: number }>(`select reltuples::int as n from pg_class where relname = $1`, [table])).rows[0].n;
const columns = async (db: Q, table: string) => (await db.query<{ n: number }>(`select count(*)::int as n from pg_stats where schemaname = 'public' and tablename = $1`, [table])).rows[0].n;

/** A map of a project with 80 tasks in it. */
async function filled() {
  const l = await fresh();
  const ops = [{ op: 'create', ref: 'p', type: 'project', title: 'Project' }, ...Array.from({ length: 80 }, (_, i) => [{ op: 'create', ref: `t${i}`, type: 'task', title: `Task ${i}` }, { op: 'link', type: 'part_of', from: `t${i}`, to: 'p' }]).flat()];
  await l.change(human, { reason: 'a map to measure', ops: ops as any });
  return l;
}

test('a newly opened database has statistics for entity and relation', async () => {
  const db = await openDb(join(folder(), 'db'));
  for (const table of ['entity', 'relation']) assert.ok((await analysed(db, table)) >= 0, `${table} was analysed when the database opened`);
  await db.close();
});

test('a restored map has statistics for its rows, before anything reads it', async () => {
  const l = await filled();
  const target = join(folder(), 'db');
  await restoreTo({ ...JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' }))), vault: await dumpVault(l.db) }, target);
  const db = await openDb(target);
  assert.ok((await analysed(db, 'entity')) > 80);
  assert.ok((await analysed(db, 'relation')) >= 80);
  assert.ok((await columns(db, 'relation')) > 0, 'the planner knows the columns of relation');
  await db.close();
});

test('enough writes since the last time make a table due again, and analysing it settles that', async () => {
  const l = await filled();
  const due = await analyzeDue(l.db);
  for (const table of ['entity', 'relation', 'log_fact']) assert.ok(due.includes(table), `${table} is due after 160 rows`);
  assert.ok((await analysed(l.db, 'relation')) >= 80);
  assert.deepEqual(await analyzeDue(l.db), [], 'nothing is due straight after');
  await l.db.close();
});

test('writes not yet analysed when a database closes are analysed before it does', async () => {
  const dir = join(folder(), 'db');
  const first = new Archipelago(await openDb(dir), (await fresh()).registry);
  const ops = Array.from({ length: 80 }, (_, i) => ({ op: 'create', type: 'task', title: `Task ${i}` }));
  await first.change(human, { reason: 'writes', ops: ops as any });
  await first.db.close();
  const db = await openDb(dir);
  assert.ok((await analysed(db, 'entity')) >= 80, 'the writes before it closed were counted');
  await db.close();
});
