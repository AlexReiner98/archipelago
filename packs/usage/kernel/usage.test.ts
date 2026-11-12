// The usage pack's code, without a database: what the log's slot log.appended hands the bytes filling, what a pack's
// manifest says it touches, and how much of it was used, read through a fake context.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { appended } from './appended.ts';
import { withUse } from './pack-use.ts';
import { told } from './reads.ts';
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

test('told counts each instruction said once, on the asking map, and answers true', async () => {
  const calls: [string, unknown][] = [];
  const at = { workspace: 'w', call: async (name: string, input: unknown) => void calls.push([name, input]), said: () => {} } as unknown as KernelContext;
  assert.equal(await told(at, { told: ['e_counted', 'e_counted'] }), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.map(([, i]) => i), [1, 2].map(() => ({ workspace: 'w', add: [{ key: 'told:e_counted', n: 1 }] })));
  await assert.rejects(told(at, { told: 'e_counted' }), /told is a list of ids/);
});

// What the loader reads a pack touching from its manifest (packs/loader/kernel/pack-touches.ts) for a type, a view and a rule.
const TOUCHES = [
  { key: 'types', n: 1, items: [{ name: 'Task', about: '0 fields', hint: '', def: { id: 'task', fields: {} }, counts: { by: 'items' as const, type: 'task' } }] },
  { key: 'views', n: 1, items: [{ name: 'V', about: 'a lens', sort: 'read', hint: '', def: { id: 'p.v', lens: {} }, counts: { by: 'view' as const, id: 'p.v' } }] },
  { key: 'rules', n: 1, items: [{ name: 'R', about: '', sort: 'holds', hint: '', def: { id: 'r', then: 'hold' }, counts: { by: 'ruling' as const, id: 'p.r' } }] },
];

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
  const [state] = await withUse(at, [{ id: 'p', touches: TOUCHES }]);
  const of = (key: string) => state.touches.find((g) => g.key === key)!;
  assert.equal(of('types').items[0].said, '3 items here, 1 made in 30 days');
  assert.equal(of('views').items[0].used, 3);
  assert.equal(of('rules').items[0].said, 'never held, refused or asked in 30 days', 'a use older than the days is not counted');
  assert.equal(of('rules').unused, 1);
  assert.deepEqual(asked.sort(), ['type_counts', 'uses_lately']);
});
