// What a painted island's look hands the map (packs/canvas/layouts/flow/painted-wires.js; decisions e_jfctpqza and
// e_a6kbgg8c): its items' places and how its lines look, checked, and the patches that route every wire touching a
// placed item to where the look draws it. Pure: what was handed in, patches out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a pack's drawing code, plain JavaScript
import { handedOf, lineOf, routeFor, wirePatches } from '../packs/canvas/layouts/flow/painted-wires.js';

test('what a look hands is checked, its own items alone, moved to the picture by its frame', () => {
  const own = new Set(['a', 'b']);
  const h = handedOf({ places: { a: [10, 20, 4], b: [5, 5], z: [1, 1], c: 'no' }, lines: { width: 'wide', curve: 3, glow: true, dash: '3 2', opacity: 2, types: { part_of: { width: 'huge' } } }, routes: { 'a>b': [[0, 0]], bad: [[1, 1]] } }, own, [100, 200]);
  assert.deepEqual([...h.places], [['a', [110, 220, 4]], ['b', [105, 205, 0]]], 'places of its own items only, a radius where given');
  assert.deepEqual(h.lines, { width: 'wide', curve: 1, glow: true, dash: '3 2', opacity: 1 }, 'a style kept within its bounds');
  assert.deepEqual(h.types, { part_of: {} }, 'a width outside the steps is dropped');
  assert.deepEqual([...h.routes], [['a>b', [[100, 200]]]], 'a route named from>to, in the picture');
  assert.equal(handedOf({}, own, [0, 0]), null, 'no places, nothing handed');
});

test('a wire runs edge to edge: a placed item’s circle, a box’s side, along a route given the right way round', () => {
  assert.deepEqual([...lineOf({ at: [0, 0], r: 5 }, { at: [100, 0], w: 40, h: 20 })], [[5, 0], [80, 0]]);
  const routes = new Map([['a>b', [[50, 50]]]]);
  assert.deepEqual(routeFor(routes, 'b', 'a'), [[50, 50]]);
  assert.equal(routeFor(routes, 'a', 'c'), null);
  const bent = lineOf({ at: [0, 0], r: 0 }, { at: [100, 0], r: 0 }, null, 1);
  assert.ok(bent.bowed && bent.length === 3 && Math.abs(bent[1][1]) > 10, 'a curve is its ends and a control point to one side');
});

test('the patches re-route each wire touching what was placed, and leave one to an item not yet placed hidden', () => {
  const wires = [
    { key: 'w:0', head: 'h:0', w: { a: 'out', b: 'in', points: [] }, type: 'depends_on' },
    { key: 'n:0', head: 'nh:0', w: { a: 'in', b: 'later', points: [] }, type: 'bears_on' },
    { key: 'n:1', head: 'nh:1', w: { a: 'out', b: 'other', points: [] }, type: 'bears_on' },
  ];
  const boxes = new Map([['out', { at: [0, 0], w: 20, h: 20 }], ['other', { at: [0, 50], w: 20, h: 20 }]]);
  const patches = wirePatches({
    wires, boxes, placed: new Map([['in', [100, 0, 10]]]), painted: new Set(['in', 'later']), changed: new Set(['in']),
    styleOf: () => ({ width: 'wide' }), draw: (w: any) => `M${w.points.map((p: number[]) => p.join(' ')).join('L')}`, heads: () => 'HEAD',
  });
  assert.deepEqual(patches.map((p: any) => p.key), ['w:0', 'h:0'], 'one wire placed; the one to an unplaced item and the one untouched are not');
  assert.equal(patches[0].set.d, 'M10 0L90 0', 'from the box’s side to the circle’s edge');
  assert.equal(patches[0].toggle.unplaced, false);
  assert.equal(patches[0].toggle['lw-wide'], true, 'in the look’s width');
  assert.equal(patches[1].set.d, 'HEAD');
});
