// The carry plan without a database: ops and a Look in, ops out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carryPlan, type Item, type Look } from './carry.ts';

function lookOf(items: Record<string, Item>, links: Record<string, { to: string; as?: string }[]> = {}): Look {
  return {
    carries: [
      { types: ['plan.import'], carry: { field: 'from_order', as: 'from', read: 'order' } },
      { types: ['plan.import'], carry: { field: 'to_order', as: 'to', read: 'order' } },
    ],
    isA: (t, a) => t === a,
    crosses: (t) => t === 'reads',
    promised: (t) => (t === 'layer' ? ['order'] : []),
    item: async (id) => items[id],
    readings: async (id) => links[id] ?? [],
  };
}

const layers = { core: { type: 'layer', props: { order: 0 } }, shell: { type: 'layer', props: { order: 14 } }, note: { type: 'note', props: { order: 3 } } };

test('a reader made with its readings takes what it reads into its create', async () => {
  const { ops, follow } = await carryPlan([
    { op: 'create', ref: 'i', type: 'plan.import', props: {} },
    { op: 'link', type: 'reads', from: 'i', to: 'shell', props: { as: 'from' } },
    { op: 'link', type: 'reads', from: 'i', to: 'core', props: { as: 'to' } },
  ], lookOf(layers));
  assert.deepEqual(ops[0].props, { from_order: 14, to_order: 0 });
  assert.deepEqual(follow, []);
});

test('a reader the change only links is followed by an update', async () => {
  const { ops, follow } = await carryPlan([{ op: 'link', type: 'reads', from: 'e_i', to: 'core', props: { as: 'to' } }], lookOf({ ...layers, e_i: { type: 'plan.import', props: { from_order: 14 } } }));
  assert.deepEqual(ops, [{ op: 'link', type: 'reads', from: 'e_i', to: 'core', props: { as: 'to' } }]);
  assert.deepEqual(follow, [{ op: 'update', id: 'e_i', props: { to_order: 0 } }]);
});

test('touching a reader refills from its live readings, only what moved', async () => {
  const look = lookOf({ ...layers, e_i: { type: 'plan.import', props: { from_order: 14, to_order: 2 } } }, { e_i: [{ to: 'shell', as: 'from' }, { to: 'core', as: 'to' }] });
  const { ops } = await carryPlan([{ op: 'update', id: 'e_i' }], look);
  assert.deepEqual(ops, [{ op: 'update', id: 'e_i', props: { to_order: 0 } }]);
});

test('nothing is taken from a field its item does not promise, nor by a link that does not cross', async () => {
  const { ops, follow } = await carryPlan([
    { op: 'create', ref: 'i', type: 'plan.import', props: {} },
    { op: 'link', type: 'reads', from: 'i', to: 'note', props: { as: 'from' } },
    { op: 'link', type: 'depends_on', from: 'i', to: 'core', props: { as: 'to' } },
  ], lookOf(layers));
  assert.deepEqual(ops[0].props, {});
  assert.deepEqual(follow, []);
});

test('with no rule that carries, the ops are as they came', async () => {
  const sent = [{ op: 'update', id: 'e_i', props: { title: 'x' } }];
  const { ops, follow } = await carryPlan(sent, { ...lookOf(layers), carries: [] });
  assert.deepEqual(ops, sent);
  assert.deepEqual(follow, []);
});
