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
