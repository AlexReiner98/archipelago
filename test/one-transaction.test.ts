// A request's reads share one transaction (packs/database/kernel/held.ts): entered once as its viewer, never reached
// by another request or viewer, read only for one who only reads, and given back whenever the request asks the
// database for anything else, so it never waits on itself.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { timed, timing } from '../src/timing.ts';
import { shares } from '../packs/database/kernel/held.ts';
import { fresh, make } from './map.ts';

type Map = Awaited<ReturnType<typeof fresh>>;

/** Two people, each with an item only they may see. */
async function twoPeople() {
  const l = await fresh();
  const people = await make(l, [
    { op: 'create', ref: 'ann', type: 'person', title: 'Ann' },
    { op: 'create', ref: 'bo', type: 'person', title: 'Bo' },
  ]);
  const own = async (who: string, name: string) =>
    ((await l.as(who).change({ kind: 'human', name, person: who }, { ops: [{ op: 'create', ref: 'p', type: 'task', title: `${name}'s own`, visibility: 'private' }], reason: 'test' })) as { created: Record<string, string> }).created.p;
  return { l, ann: people.ann, bo: people.bo, anns: await own(people.ann, 'Ann'), bos: await own(people.bo, 'Bo') };
}

/** What a person may see of the private items, asked many times, side by side and in turn, in one request: and how many transactions that took. */
const request = (l: Map, viewer: string, turns = true) =>
  timed(async () => {
    const db = l.as(viewer).db;
    const ask = async () => (await db.query<{ id: string; who: string }>(`select id, current_setting('pelago.viewer', true) as who from entity where type = 'task' and visibility = 'private' order by id`)).rows;
    const seen = [...(await Promise.all(Array.from({ length: 6 }, ask)))];
    for (let i = 0; i < 6; i++) {
      seen.push(await ask());
      if (turns) await tick(); // the other request's turn
    }
    return { seen, transactions: timing()!.waits };
  });

test('two requests side by side, by different people, each see only their own; alone, a request is one transaction', async () => {
  const { l, ann, bo, anns, bos } = await twoPeople();
  assert.equal((await request(l, ann, false)).transactions, 1, 'twelve reads, one transaction');
  const [a, b] = await Promise.all([request(l, ann), request(l, bo)]);
  for (const rows of a.seen) assert.deepEqual(rows, [{ id: anns, who: ann }], 'Ann sees her own, as herself, every time');
  for (const rows of b.seen) assert.deepEqual(rows, [{ id: bos, who: bo }], 'Bo sees his own, as himself, every time');
  // Side by side on PGlite's one connection, each gives way to the other when idle: a few transactions, not twelve.
  assert.ok(a.transactions < 12 && b.transactions < 12, `${a.transactions} and ${b.transactions} transactions`);
  // Nothing of either is left on a connection: the whole map, asked after, is no one.
  assert.equal((await l.db.query<{ who: string | null }>(`select current_setting('pelago.viewer', true) as who`)).rows[0].who || null, null);
});

test("one who only reads reads in a read-only transaction; a write in the same request has its own, and is refused", async () => {
  const { l, ann } = await twoPeople();
  await timed(async () => {
    const db = l.as(ann, false, true).db;
    assert.equal((await db.query<{ ro: string }>(`select current_setting('transaction_read_only') as ro`)).rows[0].ro, 'on');
    await assert.rejects(db.query(`update entity set title = 'changed' where false`), /read-only/);
    assert.equal((await db.query<{ ro: string }>(`select current_setting('transaction_read_only') as ro`)).rows[0].ro, 'on');
  });
  await timed(async () => {
    const db = l.as(ann).db;
    assert.equal((await db.query<{ ro: string }>(`select current_setting('transaction_read_only') as ro`)).rows[0].ro, 'off', 'a member who may write');
  });
});

test('a read that fails is its own error: the reads beside it still answer, and the next read begins anew', async () => {
  const { l, ann, anns } = await twoPeople();
  await timed(async () => {
    const db = l.as(ann).db;
    const good = () => db.query<{ id: string }>(`select id from entity where type = 'task' and visibility = 'private'`);
    const [before, bad, after] = await Promise.allSettled([good(), db.query(`select 1/0`), good()]);
    assert.equal(bad.status, 'rejected');
    assert.match(String((bad as PromiseRejectedResult).reason), /division by zero/);
    for (const r of [before, after]) assert.deepEqual(r.status === 'fulfilled' && r.value.rows.map((x) => x.id), [anns]);
    assert.deepEqual((await good()).rows.map((x) => x.id), [anns]);
  });
});

test('a request that asks the whole map, writes or opens a transaction between its reads never waits on itself', async () => {
  const { l, ann, anns } = await twoPeople();
  const { seen, transactions } = await timed(async () => {
    const me = l.as(ann);
    const read = async () => (await me.db.query<{ id: string }>(`select id from entity where type = 'task' and visibility = 'private'`)).rows.map((r) => r.id);
    const seen = await Promise.all([read(), l.db.query(`select count(*) from entity`), read(), me.db.transaction((tx) => tx.query(`select 1`)), read()]);
    await me.change({ kind: 'human', name: 'Ann', person: ann }, { ops: [{ op: 'create', type: 'task', title: 'Another' }], reason: 'test' });
    seen.push(await read());
    return { seen, transactions: timing()!.waits };
  });
  for (const i of [0, 2, 4]) assert.deepEqual(seen[i], [anns]);
  assert.ok(transactions >= 2, 'what is not a plain read has its own');
});

test('only a plain read shares a transaction', () => {
  for (const sql of ['select 1', ' with x as (select 1) select * from x', 'select id from entity where updated_at > $1']) assert.ok(shares(sql), sql);
  for (const sql of [
    'insert into entity values (1)',
    'with x as (delete from entity returning id) select * from x',
    'select * from entity for update',
    'select * from entity for share',
    `select set_config('pelago.viewer', 'x', true)`,
    'select 1; set role postgres',
    'set local role pelago_member',
    `select nextval('s')`,
    'select pg_advisory_xact_lock(1)',
    `select pelago_vault_destroy($1::text[])`,
  ])
    assert.ok(!shares(sql), sql);
});
