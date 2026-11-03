// A view kept on the map draws in what its own style says, over every other style: its shape, what it lights, and
// for pages the order of its rows. The owner changes them on the view, with no change to the code.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageStyle } from '../src/styles.ts';
import { fresh, make } from './map.ts';

test("a view's own style gives its shape, what it lights and the order of its rows; a view that says none keeps reading order", async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'v', type: 'lens', title: 'Site docs', props: { filter: { find: ['type document'] }, style: { shape: 'pages', lit: 'blocked', order: 'title' } } },
    { op: 'create', ref: 'w', type: 'lens', title: 'Docs, as read', props: { filter: { find: ['type document'] }, style: { shape: 'pages' } } },
  ]);
  const { style } = await pageStyle(l, { view: made.v });
  assert.deepEqual([style.shape, style.lit, style.order], ['pages', 'blocked', 'title']);
  assert.equal((await pageStyle(l, { view: made.w })).style.order, undefined, 'the drawing reads no order as reading order');
});

test("a style named outright, or a view's own shape, draws as it says: a project's code does not carry into it", async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Rebuild', status: 'active' },
    { op: 'create', ref: 'ridges', type: 'style', title: 'Ridges', props: { code: 'export default function draw() {}' } },
    { op: 'link', type: 'about', from: 'ridges', to: 'p' },
    { op: 'create', ref: 'flow', type: 'style', title: 'Flow', props: { shape: 'flow' } },
    { op: 'create', ref: 'v', type: 'lens', title: 'Plan', props: { filter: { find: ['type task'] }, style: { shape: 'flow' } } },
    { op: 'create', ref: 'w', type: 'lens', title: 'Ridges view', props: { filter: { find: ['type task'] } } },
  ]);
  const plain = await pageStyle(l, { of: made.p });
  assert.equal(plain.coder, made.ridges, 'with nothing nearer, the project draws by its code');
  const named = await pageStyle(l, { of: made.p, style: made.flow, have: [] });
  assert.deepEqual([named.style.code, named.coder, named.style.shape, (named.style.drawing as { shape?: string } | undefined)?.shape], [undefined, undefined, 'flow', 'flow']);
  const own = await pageStyle(l, { of: made.p, view: made.v });
  assert.deepEqual([own.style.code, own.coder], [undefined, undefined]);
  assert.equal((await pageStyle(l, { of: made.p, view: made.w })).coder, made.ridges, 'a view that says no shape draws by the code');
  const switched = await pageStyle(l, { of: made.p, shape: 'list' });
  assert.deepEqual([switched.style.code, switched.coder], [undefined, undefined]);
});
