// What a painted island's look hands the map (packs/canvas/layouts/flow/painted-wires.js; decisions e_jfctpqza and
// e_a6kbgg8c): its items' places, checked, and the patches that end every wire from another island on a placed item,
// where the look draws it. The links among one island's items are its look's, never the map's. Pure: what was handed
// in, patches out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a pack's drawing code, plain JavaScript
import { handedOf, lineOf, shoreOnly, wirePatches } from '../packs/canvas/layouts/flow/painted-wires.js';

test('what a look hands is checked, its own items alone, moved to the picture by its frame', () => {
  const h = handedOf({ places: { a: [10, 20, 4], b: [5, 5], z: [1, 1], c: 'no' } }, new Set(['a', 'b', 'c']), [100, 200]);
  assert.deepEqual([...h.places], [['a', [110, 220, 4]], ['b', [105, 205, 0]]], 'places of its own items only, a radius where given');
  assert.equal(handedOf({}, new Set(['a']), [0, 0]), null, 'no places, nothing handed');
});

test('the links among one painted island’s items are left to its look; those across its shore stay', () => {
  const island = new Map([['a', 'x'], ['b', 'x'], ['c', 'y']]);
  const g = { chains: [{ a: 'a', b: 'b' }, { a: 'a', b: 'c' }], ties: [{ a: 'b', b: 'a' }] };
  const out = shoreOnly(g, (id: string) => island.get(id), new Set(['a', 'b']));
  assert.deepEqual(out.chains, [{ a: 'a', b: 'c' }]);
  assert.deepEqual(out.ties, []);
});

test('a wire runs edge to edge: a placed item’s circle, a box’s side', () => {
  assert.deepEqual(lineOf({ at: [0, 0], r: 5 }, { at: [100, 0], w: 40, h: 20 }), [[5, 0], [80, 0]]);
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
    draw: (w: any) => `M${w.points.map((p: number[]) => p.join(' ')).join('L')}`, heads: () => 'HEAD',
  });
  assert.deepEqual(patches.map((p: any) => p.key), ['w:0', 'h:0'], 'one wire placed; the one to an unplaced item and the one untouched are not');
  assert.equal(patches[0].set.d, 'M10 0L90 0', 'from the box’s side to the circle’s edge');
  assert.equal(patches[0].toggle.unplaced, false);
  assert.equal(patches[1].set.d, 'HEAD');
});
