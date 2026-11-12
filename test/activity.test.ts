import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARRIED, doneEvents, lastSeq } from '../src/activity.ts';
import { dump, restore } from '../src/backup.ts';
import { openDb, type Database } from '../src/db.ts';
import { readEvents } from '../src/eventlog.ts';
import { OLD_EVENT } from './old-event.ts';
import { latest, migrate, versionOf } from '../src/migrate.ts';
import { dumpVault } from '../src/vault.ts';
import { Archipelago } from '../src/pelago.ts';
import { fresh, make } from './map.ts';


const tableThere = async (db: Database) => (await db.query<{ t: string | null }>(`select to_regclass('event')::text as t`)).rows[0].t !== null;

test('step 34 carries the event table’s last rows into the activity stream, each with its number, time and words, then drops it', async () => {
  const l = await fresh();
  const db = l.db as Database;
  assert.equal(await tableThere(db), false, 'a new database has none');
  const made = await make(l, [{ op: 'create', ref: 'r', type: 'task', title: 'Pushed to' }]);
  // A database from before the step: the table back, the step not taken.
  await db.exec(`${OLD_EVENT}
delete from schema_version where version >= 34;`);
  const row = async (actor: string, action: string, target: string | null, ts: string, reason: string, detail: object, origin = 'pelago') =>
    (await db.query<{ seq: number }>(`insert into event (actor, action, target_id, ts, reason, detail, origin) values ($1, $2, $3, $4, $5, $6::jsonb, $7) returning seq::int as seq`, [actor, action, target, ts, reason, JSON.stringify(detail), origin])).rows[0].seq;
  // One the app of 9 Nov 2026 had carried as the workspace opened: not carried again.
  const done = await row('agent:old', 'share.create', made.r, '2026-09-29T10:00:00.000Z', 'Carried before', {});
  await db.query(`insert into setting (key, value) values ($1, $2::jsonb)`, [CARRIED, JSON.stringify(done)]);
  const push = await row('agent:old', 'repo.push', made.r, '2026-10-01T10:00:00.000Z', 'main moved', { branch: 'main' });
  const on = await row('agent:old', 'pack.on', null, '2026-10-02T10:00:00.000Z', 'Turned on the x pack', { pack: 'x' });
  const call = await row('external:Editor', 'read_file', made.r, '2026-09-30T08:00:00.000Z', '', { ok: true }, 'external');

  await migrate(db, false);
  assert.equal(await versionOf(db), await latest());
  assert.equal(await tableThere(db), false, 'the table is gone');
  assert.deepEqual((await db.query(`select value from setting where key = $1`, [CARRIED])).rows, [], 'and where its carrying reached');
  const old = (await doneEvents(db, { oldest: true }, 50)).filter((e) => [done, push, on, call].includes(e.seq));
  assert.deepEqual(
    old.map((e) => [e.seq, new Date(e.ts).toISOString(), e.actor, e.action, e.target_id, e.reason, e.detail, e.origin]),
    [
      [push, '2026-10-01T10:00:00.000Z', 'agent:old', 'repo.push', made.r, 'main moved', { branch: 'main' }, 'pelago'],
      [on, '2026-10-02T10:00:00.000Z', 'agent:old', 'pack.on', null, 'Turned on the x pack', { pack: 'x' }, 'pelago'],
      [call, '2026-09-30T08:00:00.000Z', 'external:Editor', 'read_file', made.r, '', { ok: true }, 'external'],
    ],
    'its number, time, actor, action, item, words and where it was done; the one carried before, not again',
  );
  // What the item's history reads, the push among it; the external call is left out where only what was done here is asked.
  assert.ok((await readEvents(db, { target: made.r })).some((e) => e.seq === push));
  assert.ok(!(await readEvents(db, { target: made.r, origin: 'pelago' })).some((e) => e.seq === call));
  // What it said of the item is sealed with the item's key, as every value about an item is.
  const { rows: stored } = await db.query<{ facts: unknown }>(`select facts from log_op where stream = 'activity' and seq = $1`, [push]);
  assert.ok(!JSON.stringify(stored[0].facts).includes('main'), 'sealed, not in clear');
  // The sequence it numbered from stays: what comes after is numbered after the carried rows.
  await make(l, [{ op: 'create', type: 'record', title: 'After' }]);
  assert.ok((await lastSeq(db)) > call);
});

test('a backup from before step 34 is restored with its event rows carried into the activity stream', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'r', type: 'task', title: 'Pushed to' }]);
  const taken = JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' }, { id: 'local', types: [] })));
  const seq = (await lastSeq(l.db)) + 10;
  // As the event table held it: a row of something done outside a change set, not yet in the activity stream.
  taken.tables.event.push({ seq, workspace: 'default', ts: '2026-10-01T10:00:00.000Z', origin: 'pelago', actor: 'agent:old', action: 'repo.push', target_id: made.r, changeset: null, reason: 'main moved', detail: { branch: 'main' }, private_to: null });
  const copy = new Archipelago(await openDb(), l.registry);
  const counts = await restore(copy.db, { ...taken, vault: await dumpVault(l.db) });
  assert.ok(counts.event >= 1);
  const pushed = (await doneEvents(copy.db, { oldest: true }, 50)).find((e) => e.seq === seq);
  assert.deepEqual([pushed?.action, pushed?.target_id, pushed?.reason, pushed?.detail], ['repo.push', made.r, 'main moved', { branch: 'main' }]);
  assert.ok((await lastSeq(copy.db)) >= seq, 'what comes next is numbered after it');
});

test('what the other streams hold is read as the activity it was, as it was', async () => {
  const l = await fresh();
  await l.log(l.db, { actor: 'human:test', action: 'pack.on', reason: 'Turned on the y pack', detail: { pack: 'y' } });
  await l.record('settings', 'human:test', [['+', 'human:test', 'changes.seen', 7]]);
  await l.record('access', 'human:test', [['+', 'human:test', 'backup_download', { bytes: 2048, taken: 'now' }]]);
  const events = await readEvents(l.db, { limit: 10 });
  assert.deepEqual(events.slice(0, 3).map((e) => [e.action, e.reason]), [
    ['workspace.backup_download', 'Backup of the whole workspace downloaded (2 KB)'],
    ['changes.seen', 'Looked at what agents changed'],
    ['pack.on', 'Turned on the y pack'],
  ]);
  assert.deepEqual((await readEvents(l.db, { action: 'changes.seen' })).map((e) => e.detail), [{ upto: 7 }]);
});
