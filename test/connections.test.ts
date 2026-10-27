// Writes that stay right with many connections at once, as on a Postgres server (PELAGO_TEST_DATABASE_URL);
// on PGlite's one connection they hold trivially.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heldResources } from '../src/blocking.ts';
import { agent, fresh, make } from './map.ts';
import { append, verify } from '../src/log.ts';

test('an exclusive resource taken by many at once has one holder', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'lane', type: 'resource', title: 'Live lane' },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ op: 'create' as const, ref: `t${n}`, type: 'task', title: `Task ${n}` })),
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
    { op: 'create', ref: 'a', type: 'task', title: 'A' },
    { op: 'create', ref: 'b', type: 'task', title: 'B' },
  ]);
  await Promise.all([1, 2, 3, 4, 5].map(() => l.db.query(`select pg_sleep(0.05)`)));
  const order = (n: number) => (n % 2 ? [made.a, made.b] : [made.b, made.a]);
  const results = await Promise.allSettled([1, 2, 3, 4, 5, 6, 7, 8].map((n) => make(l, order(n).map((id) => ({ op: 'update' as const, id, props: { priority: n % 3 ? 'high' : 'low' } })))));
  assert.deepEqual(results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)), []);
});

test('writers at once append one chain: every position once, in time order, each entry the hash of the one before', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'a', type: 'task', title: 'A' }]);
  await Promise.all([1, 2, 3, 4, 5].map(() => l.db.query(`select pg_sleep(0.05)`)));
  const writes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
    n % 3 ? make(l, [{ op: 'create', type: 'task', title: `T${n}` }, { op: 'update', id: made.a, props: { priority: n % 2 ? 'high' : 'low' } }]) : l.change(agent, { reason: `held ${n}`, ops: [{ op: 'update', id: made.a, title: `A${n}` }] }),
  );
  assert.deepEqual((await Promise.allSettled(writes)).filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)), []);
  for (const stream of ['facts', 'pending'] as const) {
    const v = await verify(l.db, stream);
    assert.deepEqual(v.problems, [], `the ${stream} stream verifies`);
    const { rows } = await l.db.query<{ pos: number; at: string }>(`select pos::int as pos, at from log_entry where stream = $1 order by pos`, [stream]);
    assert.deepEqual(rows.map((r) => r.pos), rows.map((_, i) => i + 1), 'no position twice, none missing');
    assert.ok(rows.every((r, i) => !i || new Date(r.at) >= new Date(rows[i - 1].at)), 'time never goes back');
  }
  assert.equal((await verify(l.db)).entries, 1 + 7);
  assert.equal((await verify(l.db, 'pending')).entries, 3);
});

test('an append waits for the stream’s lock while another holds it, and follows it', async () => {
  const l = await fresh();
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const first = l.db.transaction(async (tx) => {
    await append(tx, 'default', 'facts', { id: 'c_first', actor: { id: 'human:test' }, reason: 'first' }, []);
    await gate;
  });
  await new Promise((r) => setTimeout(r, 100));
  let second = false;
  const after = l.db.transaction((tx) => append(tx, 'default', 'facts', { id: 'c_second', actor: { id: 'human:test' }, reason: 'second' }, [])).then(() => (second = true));
  await new Promise((r) => setTimeout(r, 300));
  const waited = !second;
  open();
  await Promise.all([first, after]);
  assert.ok(waited, 'the second append waited for the first to commit');
  const { rows } = await l.db.query<{ id: string; pos: number }>(`select id, pos::int as pos from log_entry order by pos`);
  assert.deepEqual(rows, [{ id: 'c_first', pos: 1 }, { id: 'c_second', pos: 2 }]);
  assert.deepEqual((await verify(l.db)).problems, []);
});
