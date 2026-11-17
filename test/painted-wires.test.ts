// The wires that come into a painted island (packs/canvas/layouts/flow/painted-wires.js; task e_vtuj8n8a): each says
// where it meets the island's frame, which item inside it ends on, and whether its head is at that end, so the surface
// carries it on to where the look draws that item. Pure: a composed model in, places out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a pack's drawing code, plain JavaScript
import { comingIn, edgeOf } from '../packs/canvas/layouts/flow/painted-wires.js';

const frame = { at: [100, 0], size: [200, 100] };

test('a segment from outside to inside meets the frame where it crosses its nearest edge', () => {
  assert.deepEqual(edgeOf([0, 50], [150, 50], frame), [100, 50]);
  assert.deepEqual(edgeOf([200, 200], [200, 50], frame), [200, 100]);
});

test('a wire into a painted island ends on its item there, with its head where the link points', () => {
  const items = [{ id: 'out', island: 'other' }, { id: 'in', island: 'big' }, { id: 'in2', island: 'big' }];
  const g = {
    chains: [{ a: 'out', b: 'in', points: [[0, 50], [50, 50], [150, 50]] }],
    ties: [{ a: 'in2', b: 'out', type: 'bears_on', points: [[150, 80], [150, 150], [0, 150]] }, { a: 'in', b: 'in2', type: 'bears_on', points: [[150, 50], [150, 80]] }],
  };
  const wires = comingIn({ id: 'big', canvas: frame }, { g, items, painted: new Set(['in', 'in2']), endsOf: () => 'end', order: 'depends_on' });
  assert.deepEqual(wires, [
    { item: 'in', at: [100, 50], head: true },
    { item: 'in2', at: [150, 100], head: false },
  ], 'one in from the left, its head inside; one out through the floor, its head outside; none between two painted items');
});
