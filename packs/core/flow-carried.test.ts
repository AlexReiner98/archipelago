// A wire cut onto a trunk is lit on along it when its step is hovered: what carries it, and how far, is read off the
// wires alone (./layouts/flow/carried.js), so a leaf's hover reaches the item the trunk serves, not only its branch.

import assert from 'node:assert/strict';
import test from 'node:test';
import { carried } from './layouts/flow/carried.js';

test('a branch that ends on a trunk is carried on to the item they share', () => {
  // Y's wire runs whole down to H; X's joins it at (10, 50) and ends there, on the trunk.
  const wires = [
    { a: 'Y', b: 'H', points: [[10, 0], [10, 50], [10, 100]] },
    { a: 'X', b: 'H', points: [[40, 40], [40, 50], [10, 50]], toPort: true },
  ];
  const [y, x] = carried(wires);
  assert.deepEqual(y, []);
  assert.deepEqual(x, [{ k: 0, end: true, points: [[10, 50], [10, 100]] }]);
});

test('a branch that starts at a stop is carried back to the item it leaves', () => {
  const wires = [
    { a: 'H', b: 'Y', points: [[10, 0], [10, 50], [10, 100]] },
    { a: 'H', b: 'X', points: [[10, 50], [40, 50], [40, 60]], stop: true },
  ];
  assert.deepEqual(carried(wires)[1], [{ k: 0, end: false, points: [[10, 0], [10, 50]] }]);
});

test('a branch on a branch is carried through both to the trunk\'s item', () => {
  const wires = [
    { a: 'Y', b: 'H', points: [[10, 0], [10, 100]] },
    { a: 'X', b: 'H', points: [[40, 0], [40, 50], [10, 50]], toPort: true },
    { a: 'W', b: 'H', points: [[70, 0], [70, 20], [40, 20]], toPort: true },
  ];
  assert.deepEqual(carried(wires)[2], [{ k: 1, end: true, points: [[40, 20], [40, 50], [10, 50]] }, { k: 0, end: true, points: [[10, 50], [10, 100]] }]);
});

test('a trunk in that lands on the trunk out is carried on into the item by the wire out', () => {
  // Q's wire ends on the wire out of H to B, short of H's side at (118, 173): that wire's first stretch takes it in.
  const wires = [
    { a: 'Q', b: 'H', points: [[106, 41], [130, 41], [130, 173]], toPort: true },
    { a: 'H', b: 'B', points: [[118, 173], [130, 173], [130, 349], [100, 349]] },
  ];
  assert.deepEqual(carried(wires)[0], [{ k: 1, end: false, points: [[118, 173], [130, 173]] }]);
});

test('a wire to another item is not taken for a trunk', () => {
  const wires = [
    { a: 'Y', b: 'G', points: [[10, 0], [10, 100]] },
    { a: 'X', b: 'H', points: [[40, 0], [40, 50], [10, 50]], toPort: true },
  ];
  assert.deepEqual(carried(wires)[1], []);
});
