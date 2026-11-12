// Unwait run without a database: a query that answers from a few rows in memory, the facts out. The whole of it against
// a real map is test/unwait.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { follow, type Q, type Reg, type Unwaited, unwaitFollows, whoseWord } from './unwait.ts';

const reg: Reg = { relationFamily: (...r) => r, type: (id) => (id === 'task' ? { statuses: { closed: ['done'] } } : undefined) };
const q: Q = {
  query: async <T>(sql: string) => ({ rows: (sql.includes('from entity') ? [{ type: 'task' }] : [{ id: 'r1', from_id: 't1' }, { id: 'r2', from_id: 't1' }]) as T[] }),
};

test("closing an item on a person's word takes back its waits_on to them, but those the change unlinks", async () => {
  const gone: Unwaited[] = [];
  const facts = await unwaitFollows(q, reg, { op: 'update', id: 't1', status: 'done' }, 'p', gone, [{ op: 'unlink', relation: 'r2' }]);
  assert.deepEqual(facts, [['-', 'r1', 'link']]);
  assert.deepEqual(gone, [{ item: 't1', person: 'p', relation: 'r1' }]);
});

test('as a ride: after a closing op, its unlinks ride the change and the answer names them; elsewhere, nothing', async () => {
  const ctx = {} as KernelContext;
  const ops = [{ op: 'update', id: 't1', status: 'done' }];
  assert.deepEqual(await follow(ctx, ops, { q, at: 0, place: 'after', word: 'p', registry: reg }), {
    ops: [{ op: 'unlink', relation: 'r1' }, { op: 'unlink', relation: 'r2' }],
    answer: { unwaited: [{ item: 't1', person: 'p', relation: 'r1' }, { item: 't1', person: 'p', relation: 'r2' }] },
  });
  assert.deepEqual(await follow(ctx, ops, { q, at: 0, place: 'source', word: 'p', registry: reg }), {});
  assert.deepEqual(await follow(ctx, ops, { q, at: 0, place: 'after', word: null, registry: reg }), {});
});

test('on no word, or short of closing, nothing follows', async () => {
  assert.deepEqual(await unwaitFollows(q, reg, { op: 'update', id: 't1', status: 'done' }, null, []), []);
  assert.deepEqual(await unwaitFollows(q, reg, { op: 'update', id: 't1', status: 'doing' }, 'p', []), []);
});

test("whose word: the person read as, only on a human's authority", async () => {
  const ctx = { reads: async (r: Record<string, unknown>) => (r.me ? 'p' : undefined) } as unknown as KernelContext;
  assert.equal(await whoseWord(ctx, { of: 'human' }), 'p');
  assert.equal(await whoseWord(ctx, { of: 'agent' }), null);
});
