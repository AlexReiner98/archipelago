// The usage pack's code, without a database: what the log's slot log.appended hands the bytes filling, what a pack's
// manifest says it touches, and how much of it was used, read through a fake context.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { appended } from './appended.ts';
import { gist, packTouches } from './pack-touches.ts';
import { withUse } from './pack-use.ts';
import { used } from './uses.ts';

const DAY = new Date().toISOString().slice(0, 10);

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

test('a use is counted through root.uses, on the context’s workspace or the one named', async () => {
  const calls: [string, unknown][] = [];
  const at = { workspace: 'w', call: async (name: string, input: unknown) => void calls.push([name, input]) } as unknown as KernelContext;
  await used(at, 'view', 'core.frontier');
  await used(at, 'held', 'core.asked rule', 2, 'other');
  await used(at, 'told', '');
  assert.deepEqual(calls, [
    ['root.uses', { workspace: 'w', add: [{ key: 'view:core.frontier', n: 1 }] }],
    ['root.uses', { workspace: 'other', add: [{ key: 'held:core.asked_rule', n: 2 }] }],
  ]);
});

test('beside each counted thing, its use: the items standing, and the uses written down and held summed', async () => {
  const asked: string[] = [];
  const at = {
    reads: async (q: Record<string, unknown>) => {
      asked.push(Object.keys(q)[0]);
      if (q.type_counts) return { items: [{ type: 'task', n: 3, lately: 1 }], links: [] };
      return [{ facts: [['+', 'key:view:p.v', DAY, 2], ['+', 'key:held:p.r', '2000-01-01', 9]] }];
    },
    call: async () => [{ key: 'view:p.v', day: DAY, n: 1 }],
  } as unknown as KernelContext;
  const [state] = await withUse(at, [{ id: 'p', touches: packTouches({ id: 'p', types: [{ id: 'task', fields: {} }], views: [{ id: 'p.v', lens: {} }], rules: [{ id: 'r', then: 'hold' }] }) }]);
  const of = (key: string) => state.touches.find((g) => g.key === key)!;
  assert.equal(of('types').items[0].said, '3 items here, 1 made in 30 days');
  assert.equal(of('views').items[0].used, 3);
  assert.equal(of('rules').items[0].said, 'never held, refused or asked in 30 days', 'a use older than the days is not counted');
  assert.equal(of('rules').unused, 1);
  assert.deepEqual(asked.sort(), ['type_counts', 'uses_lately']);
});
