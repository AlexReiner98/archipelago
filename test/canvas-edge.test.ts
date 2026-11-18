// The camera opens readable on the islands that fit and names the rest at the frame's edge (study "The canvas, by eye",
// verdict e_amqnqtsn): which islands open together (`leading`, packs/walls/page/pan-zoom.js) and where the rest are
// named (`outOfSight`, packs/surface/page/canvas-edge.js). Pure: no page.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { leading } from '../packs/walls/page/pan-zoom.js';
// @ts-ignore: a module of the page, plain JavaScript
import { outOfSight } from '../packs/surface/page/canvas-edge.js';

const ROOM = [0, 48, 1000, 700];

test('as many islands from the first as read whole together open', () => {
  const boxes = [[0, 0, 500, 400], [520, 0, 900, 300], [920, 0, 1800, 500]];
  const got = leading(boxes, ROOM, 16, 0.7);
  assert.equal(got.n, 2, 'the third would take it under the least');
  assert.deepEqual(got.box, [0, 0, 900, 400]);
});

test('a first island too big to read whole opens alone, at the floor from its top left (the floor wins)', () => {
  const got = leading([[0, 0, 3000, 900], [3020, 0, 3400, 200]], ROOM, 16, 0.7);
  assert.deepEqual(got, { n: 1, box: [0, 0, 3000, 900] });
});

test('no islands open nothing', () => {
  assert.deepEqual(leading([], ROOM, 16, 0.7), { n: 0, box: null });
});

test('an island wholly out of the room is named on the edge toward it, in reading order', () => {
  const v = { x: 0, y: 0, s: 1 };
  const out = outOfSight([['a', [10, 60, 400, 300]], ['b', [1200, 60, 1600, 300]], ['c', [100, 900, 300, 1000]], ['d', [1100, 2000, 1300, 2100]]], ROOM, v);
  assert.deepEqual(out, [['b', [1, 0], false], ['c', [0, 1], false], ['d', [0, 1], false]], 'a is in sight; b to the right; c and d below, in order');
});

test('an island cut by the edge is named on each edge it runs past: it goes on there', () => {
  assert.deepEqual(outOfSight([['a', [900, 60, 1400, 300]]], ROOM, { x: 0, y: 0, s: 1 }), [['a', [1, 0], true]]);
  assert.deepEqual(outOfSight([['a', [10, 400, 1400, 900]]], ROOM, { x: 0, y: 0, s: 1 }), [['a', [1, 0], true], ['a', [0, 1], true]]);
});
