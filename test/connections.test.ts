// Writes that stay right with many connections at once, as on a Postgres server (PELAGO_TEST_DATABASE_URL);
// on PGlite's one connection they hold trivially.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heldResources } from '../src/blocking.ts';
import { agent, fresh, make } from './map.ts';

test('an exclusive resource taken by many at once has one holder', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'lane', type: 'resource', title: 'Live lane' },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ op: 'create' as const, ref: `t${n}`, type: 'work.task', title: `Task ${n}` })),
  ]);
  // Every connection open first, so the claims run side by side rather than one per connection as each opens.
  await Promise.all([1, 2, 3, 4, 5].map(() => l.db.query(`select pg_sleep(0.05)`)));
  const tries = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((n) => l.claim(agent, { resource: made.lane, holder: made[`t${n}`], reason: 'test' })));
  assert.equal(tries.filter((t) => t.status === 'fulfilled').length, 1, 'one took it');
  assert.equal((await heldResources(l)).length, 1);
});

test('an event is not seen before one numbered ahead of it that is still being written', async () => {
  const l = await fresh();
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const first = l.db.transaction(async (tx) => {
    await l.log(tx, { actor: 'human:test', action: 'test.first', reason: 'test' });
    await gate;
  });
  await new Promise((r) => setTimeout(r, 100));
  let second = false;
  const after = l.log(l.db, { actor: 'human:test', action: 'test.second', reason: 'test' }).then(() => (second = true));
  await new Promise((r) => setTimeout(r, 300));
  const waited = !second;
  open();
  await Promise.all([first, after]);
  assert.ok(waited, 'the later event waits for the earlier one to be written');
  const { rows } = await l.db.query<{ action: string }>(`select action from event where action like 'test.%' order by seq`);
  assert.deepEqual(rows.map((r) => r.action), ['test.first', 'test.second']);
});

test('changes at once to the same items in either order all go through', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'B' },
  ]);
  await Promise.all([1, 2, 3, 4, 5].map(() => l.db.query(`select pg_sleep(0.05)`)));
  const order = (n: number) => (n % 2 ? [made.a, made.b] : [made.b, made.a]);
  const results = await Promise.allSettled([1, 2, 3, 4, 5, 6, 7, 8].map((n) => make(l, order(n).map((id) => ({ op: 'update' as const, id, props: { priority: n % 3 ? 'high' : 'low' } })))));
  assert.deepEqual(results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)), []);
});
