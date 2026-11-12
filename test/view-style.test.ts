// A view kept on the map draws in what its own style says, over every other style: its shape, what it lights, and
// for pages the order of its rows. The owner changes them on the view, with no change to the code.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as stylesPack from '../packs/styles/kernel/styles.ts';
import { fresh, make } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

test("a view's own style gives its shape, what it lights and the order of its rows; a view that says none keeps reading order", async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'v', type: 'lens', title: 'Findings', props: { filter: { find: ['type finding'] }, style: { shape: 'map', lit: 'blocked', order: 'title' } } },
    { op: 'create', ref: 'w', type: 'lens', title: 'Findings, as read', props: { filter: { find: ['type finding'] }, style: { shape: 'map' } } },
  ]);
  const { style } = await stylesPack.pageStyle(kernelContext(l, 'styles'), { view: made.v });
  assert.deepEqual([style.shape, style.lit, style.order], ['map', 'blocked', 'title']);
  assert.equal((await stylesPack.pageStyle(kernelContext(l, 'styles'), { view: made.w })).style.order, undefined, 'the drawing reads no order as reading order');
});

test("a style named outright, or a view's own shape, draws as it says: a task's code does not carry into it", async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'Rebuild', status: 'doing' },
    { op: 'create', ref: 'ridges', type: 'layout', title: 'Ridges', props: { code: 'export default function draw() {}' } },
    { op: 'link', type: 'about', from: 'ridges', to: 'p' },
    { op: 'create', ref: 'flow', type: 'style', title: 'Map', props: { shape: 'map' } },
    { op: 'create', ref: 'v', type: 'lens', title: 'Plan', props: { filter: { find: ['type task'] }, style: { shape: 'map' } } },
    { op: 'create', ref: 'w', type: 'lens', title: 'Ridges view', props: { filter: { find: ['type task'] } } },
  ]);
  const plain = await stylesPack.pageStyle(kernelContext(l, 'styles'), { of: made.p });
  assert.equal(plain.coder, made.ridges, 'with nothing nearer, the task draws by its code');
  const named = await stylesPack.pageStyle(kernelContext(l, 'styles'), { of: made.p, style: made.flow, have: [] });
  assert.deepEqual([named.style.code, named.coder, named.style.shape, (named.style.drawing as { shape?: string } | undefined)?.shape], [undefined, undefined, 'map', 'map']);
  const own = await stylesPack.pageStyle(kernelContext(l, 'styles'), { of: made.p, view: made.v });
  assert.deepEqual([own.style.code, own.coder], [undefined, undefined]);
  assert.equal((await stylesPack.pageStyle(kernelContext(l, 'styles'), { of: made.p, view: made.w })).coder, made.ridges, 'a view that says no shape draws by the code');
  const switched = await stylesPack.pageStyle(kernelContext(l, 'styles'), { of: made.p, shape: 'map' });
  assert.deepEqual([switched.style.code, switched.coder], [undefined, undefined]);
});
