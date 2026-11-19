// Where the plane stands to show a box (packs/walls/page/pan-zoom.js, `framed`): all of it when that reads, else at the
// style's least readable scale from its top left (e_5cp4fw78), which the canvas fits a big island by and goes to an
// island by (hooks.toIsland, e_wmqwkfdd). Pure: no page.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { framed } from '../packs/walls/page/pan-zoom.js';

/** Where a point of the picture lands on the frame, seen from `v`. */
const onFrame = (v: { s: number; x: number; y: number }, [px, py]: [number, number]) => [(px - v.x) * v.s, (py - v.y) * v.s];

test('a box that reads whole is shown whole, centred in the room', () => {
  const v = framed([0, 0, 400, 200], [0, 0, 1000, 600], 16, 0.7);
  assert.equal(v.s, 1, 'never larger than its own size');
  assert.equal(v.whole, 1);
  const [l, t] = onFrame(v, [0, 0]), [r, b] = onFrame(v, [400, 200]);
  assert.deepEqual([l + r, t + b], [1000, 600], 'centred both ways');
});

test('a box too big to read whole is shown at the least readable scale, from its top left', () => {
  const v = framed([24, 24, 2300, 2070], [0, 0, 1000, 600], 16, 0.7);
  assert.equal(v.s, 0.7);
  assert.ok(v.whole < 0.7, 'the scale that shows all of it, kept for zooming out to it');
  assert.deepEqual(onFrame(v, [24, 24]), [8, 8], 'its top left at the room’s, half the pad in');
});

test('one way that fits is still centred, the other starts at its top', () => {
  const v = framed([0, 0, 600, 3000], [0, 0, 1000, 600], 16, 0.7);
  assert.equal(v.s, 0.7);
  const [l, t] = onFrame(v, [0, 0]), [r] = onFrame(v, [600, 3000]);
  assert.ok(Math.abs(l + r - 1000) < 1e-9, 'centred across');
  assert.ok(Math.abs(t - 8) < 1e-9, 'from the top down');
});

test('the room is beside what covers the frame: a legend on the left, the bars over it', () => {
  const v = framed([0, 0, 5000, 5000], [120, 40, 880, 500], 16, 0.7);
  assert.deepEqual(onFrame(v, [0, 0]).map((n) => Math.round(n * 1e9) / 1e9), [128, 48]);
});

test('with no least, all of it is fitted however small', () => {
  const v = framed([0, 0, 5000, 5000], [0, 0, 1000, 600], 16);
  assert.equal(v.s, v.whole);
  assert.ok(v.s < 0.2);
});

test('high: a box that fits down the room stands at its top, still centred across', () => {
  const v = framed([0, 0, 4000, 500], [0, 48, 1000, 600], 16, 0, true);
  const [l, t] = onFrame(v, [0, 0]), [r] = onFrame(v, [4000, 500]);
  assert.ok(Math.abs(t - 56) < 1e-9, 'its top half the pad under the room’s');
  assert.ok(Math.abs(l + r - 1000) < 1e-9, 'centred across');
});
