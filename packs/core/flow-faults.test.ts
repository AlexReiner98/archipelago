// How wires stand beside one another, counted apart by the way they run: lines in, numbers out.

import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error a drawing's modules are plain JavaScript
import { spacing } from './layouts/flow/faults.js';

const down = (x: number, ends = ['a', 'b']) => ({ ends, points: [[x, 0], [x, 100]] });
const across = (y: number, ends = ['a', 'b']) => ({ ends, points: [[0, y], [100, y]] });

test('spacing: wires on one line are an overlap between boxes and shared within one', () => {
  const s = spacing([down(0, ['a', 'b']), down(0, ['c', 'd']), down(0, ['a', 'e'])], 12);
  assert.equal(s.down.overlaps, 2);
  assert.equal(s.down.overlapLength, 200);
  assert.equal(s.down.shared, 1);
  assert.equal(s.across.overlaps, 0);
});

test('spacing: neighbours are counted by how far apart they stand, on their own axis', () => {
  const s = spacing([down(0, ['a', 'b']), down(5, ['c', 'd']), down(17, ['e', 'f']), down(32, ['g', 'h']), across(50, ['i', 'j'])], 12);
  assert.deepEqual([s.down.under, s.down.at, s.down.between], [1, 1, 1]);
  assert.equal(s.across.at + s.across.under + s.across.between, 0);
});

test('spacing: a wire between two keeps them from being neighbours', () => {
  const s = spacing([across(0, ['a', 'b']), across(12, ['c', 'd']), across(24, ['e', 'f'])], 12);
  assert.equal(s.across.at, 2);
  assert.equal(s.across.wide, 0);
});

test('spacing: wires that do not run beside one another are not counted', () => {
  const s = spacing([down(0, ['a', 'b']), { ends: ['c', 'd'], points: [[5, 200], [5, 300]] }], 12);
  assert.equal(s.down.under, 0);
});
