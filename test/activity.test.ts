import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carryEvents, doneEvents, lastSeq } from '../src/activity.ts';
import { readEvents } from '../src/eventlog.ts';
import { fresh, make } from './map.ts';

test('the event table’s rows are carried into the activity stream once, each with its number, time and words', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'r', type: 'task', title: 'Pushed to' }]);
  const row = async (actor: string, action: string, target: string | null, ts: string, reason: string, detail: object, origin = 'pelago') =>
    (await l.db.query<{ seq: number }>(`insert into event (actor, action, target_id, ts, reason, detail, origin) values ($1, $2, $3, $4, $5, $6::jsonb, $7) returning seq::int as seq`, [actor, action, target, ts, reason, JSON.stringify(detail), origin])).rows[0].seq;
  const push = await row('agent:old', 'repo.push', made.r, '2026-10-01T10:00:00.000Z', 'main moved', { branch: 'main' });
  const on = await row('agent:old', 'pack.on', null, '2026-10-02T10:00:00.000Z', 'Turned on the x pack', { pack: 'x' });
  const call = await row('external:Editor', 'read_file', made.r, '2026-09-30T08:00:00.000Z', '', { ok: true }, 'external');

  assert.equal(await carryEvents(l.db, l.workspace, l.registry.rules), 3);
  assert.equal(await carryEvents(l.db, l.workspace, l.registry.rules), 0, 'each is carried once');
  const old = (await doneEvents(l.db, { oldest: true }, 50)).filter((e) => [push, on, call].includes(e.seq));
  assert.deepEqual(
    old.map((e) => [e.seq, new Date(e.ts).toISOString(), e.actor, e.action, e.target_id, e.reason, e.detail, e.origin]),
    [
      [push, '2026-10-01T10:00:00.000Z', 'agent:old', 'repo.push', made.r, 'main moved', { branch: 'main' }, 'pelago'],
      [on, '2026-10-02T10:00:00.000Z', 'agent:old', 'pack.on', null, 'Turned on the x pack', { pack: 'x' }, 'pelago'],
      [call, '2026-09-30T08:00:00.000Z', 'external:Editor', 'read_file', made.r, '', { ok: true }, 'external'],
    ],
    'its number, time, actor, action, item, words and where it was done',
  );
  // What the item's history reads, the push among it; the external call is left out where only what was done here is asked.
  assert.ok((await readEvents(l.db, { target: made.r })).some((e) => e.seq === push));
  assert.ok(!(await readEvents(l.db, { target: made.r, origin: 'pelago' })).some((e) => e.seq === call));
  // What it said of the item is sealed with the item's key, as every value about an item is.
  const { rows: stored } = await l.db.query<{ facts: unknown }>(`select facts from log_op where stream = 'activity' and seq = $1`, [push]);
  assert.ok(!JSON.stringify(stored[0].facts).includes('main'), 'sealed, not in clear');

  // A row an older app wrote while this one took over is carried the next time.
  const late = await row('agent:old', 'share.create', made.r, new Date().toISOString(), 'A link was made', {});
  assert.equal(await carryEvents(l.db, l.workspace, l.registry.rules), 1);
  assert.ok(await lastSeq(l.db) >= late);
});

test('what the other streams hold is read as the activity it was, and the event table is written no more', async () => {
  const l = await fresh();
  const before = Number((await l.db.query<{ n: number }>(`select count(*)::int as n from event`)).rows[0].n);
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
  assert.equal(Number((await l.db.query<{ n: number }>(`select count(*)::int as n from event`)).rows[0].n), before);
});
