// The usage pack's code, without a database: what the log's slot log.appended hands the bytes filling, and what a
// pack's manifest says it touches.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { appended } from './appended.ts';
import { gist, packTouches } from './pack-touches.ts';

const ctx = {} as KernelContext;

test('an append is counted through its pack’s own function, the facts as they were stored', async () => {
  const calls: [string, unknown][] = [];
  const facts = [['+', 'e_1', 'title', 'sealed:abc'], ['-', 'r_2', 'valid_to']];
  await appended(ctx, { facts }, { definer: async (name, arg) => void calls.push([name, arg]) });
  assert.deepEqual(calls, [['pelago_bytes_add', facts]]);
});

test('an append with no facts counts nothing', async () => {
  const calls: unknown[] = [];
  await appended(ctx, { facts: [] }, { definer: async (...a) => void calls.push(a) });
  assert.deepEqual(calls, []);
});

test('what a pack touches is read from its manifest alone, each counted thing saying how', () => {
  const groups = packTouches({ id: 'p', version: '1', types: [{ id: 'task', title: 'Task', fields: { due: {} } }], views: [{ id: 'p.v', lens: {} }], rules: [{ id: 'r', then: 'hold', when: { actor: 'agent' } }] } as never);
  const of = (key: string) => groups.find((g) => g.key === key)!;
  assert.deepEqual(of('types').items[0].counts, { by: 'items', type: 'task' });
  assert.deepEqual(of('views').items[0].counts, { by: 'view', id: 'p.v' });
  assert.deepEqual(of('rules').items[0].counts, { by: 'ruling', id: 'p.r' });
  assert.equal(of('rules').items[0].sort, 'holds');
  assert.equal(gist('Holds a change. And more.'), 'Holds a change');
});
