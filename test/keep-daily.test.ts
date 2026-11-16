// The leader's daily keeping of a map (packs/log/kernel/open.ts) asks the database whether it is done, not the process:
// a server restarted on the same code (every deploy) finds today's snapshot and keeps nothing, and a snapshot at the
// head of both streams is not taken again. A paced walk rests between its chunks and makes the same snapshot.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fresh, make } from './map.ts';
import type { Workspace } from '../packs/identity/kernel/workspaces.ts';
import { keepSnapshots, keptToday } from '../packs/log/kernel/open.ts';
import { snapshotNow } from '../packs/log/kernel/rebuild.ts';
import { newestHead } from '../packs/log/kernel/snapshot.ts';

const kept = async (l: { db: { query: <T>(s: string) => Promise<{ rows: T[] }> } }) =>
  (await l.db.query<{ id: string; taken_at: Date }>(`select id, taken_at from log_snapshot order by id`)).rows.map((r) => `${r.id}@${new Date(r.taken_at).toISOString()}`);

test('a map kept today is not kept again, and a snapshot at the head is not taken twice', async () => {
  const l = await fresh();
  const ws = { id: 'w', pelago: l } as unknown as Workspace;
  await make(l, [{ op: 'create', ref: 'a', type: 'task', title: 'Kept once' }]);
  assert.equal(await keptToday(ws), false, 'no snapshot yet: due');

  await keepSnapshots(ws);
  assert.equal(await keptToday(ws), true, 'a snapshot this code made today');
  assert.equal(await keptToday(ws, new Date(Date.now() + 86_400_000)), false, 'due again tomorrow');
  const once = await kept(l);
  assert.equal(once.length, 1);

  await keepSnapshots(ws);
  assert.deepEqual(await kept(l), once, 'nothing appended since: the same snapshot, not taken again');

  await make(l, [{ op: 'create', ref: 'b', type: 'task', title: 'Said since' }]);
  await keepSnapshots(ws);
  const twice = await kept(l);
  assert.equal(twice.length, 2, 'something appended: a snapshot at the new head');
  const head = (await newestHead(l.db))!;
  assert.ok(head.positions.facts > Number(once[0].split('_')[1]));
});

test('a paced walk rests between its chunks and comes to the same head', async () => {
  const l = await fresh();
  for (let i = 0; i < 6; i++) await make(l, [{ op: 'create', ref: 'a', type: 'task', title: `Step ${i}` }]);
  const done = await snapshotNow(l.db, l.registry, l.workspace, { chunk: 2, pace: 1, fromStart: true });
  assert.ok(done.chunks > 2, `walked in chunks (${done.chunks})`);
  const plain = await snapshotNow(l.db, l.registry, l.workspace, { fromStart: true });
  assert.deepEqual(plain.to, done.to);
});
