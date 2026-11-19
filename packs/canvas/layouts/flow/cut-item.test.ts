// A box cut by a mountain curve, pass 2 (round 6, screen e_vm8eg36x): two primitives, one tension, no kinks.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// @ts-ignore a page module, untyped
import { bandOf, boxHeight, cuts, GROWN, listOf } from './cut-item.js';
// @ts-ignore a page module, untyped
import { grammar, itemMarks } from './item-look.js';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'pack.json'), 'utf8'));
const house = pack.styles.find((s: any) => s.id === 'core.house').props;
const preset = (id: string) => pack.styles.find((s: any) => s.id === id);
const box = { l: 0, t: 0, r: 160, b: 60 };
const cutOf = (name: string, seed = 1, scale = 1) => cuts(box, house.cut_forms[name], { rx: 6, tension: 0.55, scale, seed });
const unit = (a: number[], b: number[]) => ((dx, dy) => [dx / Math.hypot(dx, dy), dy / Math.hypot(dx, dy)])(b[0] - a[0], b[1] - a[1]);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test('every named cut is a list of the two primitives, and the types name them', () => {
  for (const [name, list] of Object.entries(house.cut_forms) as [string, any[]][]) for (const p of list) assert.ok(typeof p.at === 'string' ? ['tl', 'tr', 'bl', 'br'].includes(p.at) : p.at >= 0 && p.at <= 1, name);
  for (const t of ['task', 'work', 'place', 'record', 'question', 'decision', 'aim', 'occurrence', 'actor', 'system']) assert.ok(house.cut_forms[preset('canvas.cut_faroe').props.type_cuts[t]], t);
  assert.equal(cutOf('twin').length, 2);
  assert.equal(cutOf('ring').length, 4);
});

test('a list in a type, or a name, gives the same cut; a flavour takes its starter\'s', () => {
  const cut = { types: { task: 'slope', work: [{ at: 0.5, w: 0.3, d: 0.4 }] }, forms: house.cut_forms };
  assert.deepEqual(listOf(cut, {}, ['task']), house.cut_forms.slope);
  assert.equal(listOf(cut, {}, ['mytask', 'work']).length, 1);
});

test('no kinks: every curve meets the box edge, and its neighbour, along the same tangent', () => {
  for (const name of Object.keys(house.cut_forms)) for (const seed of [1, 2, 3]) for (const region of cutOf(name, seed)) {
    const c = region.cubics;
    if (c.length === 2) {
      // A bell: level where it leaves the top edge, level at its low point on both sides, level where it comes back.
      assert.ok(near(c[0][0][1], box.t) && near(c[0][1][1], box.t), `${name} leaves the edge level`);
      assert.ok(near(c[0][2][1], c[0][3][1]) && near(c[1][1][1], c[1][0][1]), `${name} low point level`);
      assert.deepEqual(c[0][3], c[1][0]);
      assert.ok(near(c[1][2][1], box.t) && near(c[1][3][1], box.t), `${name} returns level`);
    } else {
      // A corner arc: along the side where it starts, along the top or foot where it ends.
      const [p0, p1, p2, p3] = c[0], [u, v] = [unit(p0, p1), unit(p2, p3)];
      assert.ok(near(u[0], 0) && near(Math.abs(u[1]), 1), `${name} leaves the side along it`);
      assert.ok(near(v[1], 0) && near(Math.abs(v[0]), 1), `${name} meets the edge along it`);
    }
    for (const seg of c) for (const [x, y] of seg) assert.ok(x >= box.l - 1e-6 && x <= box.r + 1e-6 && y >= box.t - 1e-6 && y <= box.b + 1e-6, `${name} inside`);
  }
});

test('one tension: a tighter one pulls the handles in, everywhere', () => {
  const at = (k: number) => cuts(box, house.cut_forms.peak, { rx: 6, tension: k, seed: 1 })[0].cubics[0];
  assert.ok(at(0.3)[1][0] < at(0.55)[1][0]);
});

test('the same seed gives the same cut, and a bell\'s foot shifts only a little', () => {
  assert.equal(cutOf('slope', 4)[0].d, cutOf('slope', 4)[0].d);
  assert.notEqual(cutOf('slope', 4)[0].d, cutOf('slope', 5)[0].d);
  assert.ok(Math.abs(cutOf('peak', 4)[0].cubics[0][3][0] - cutOf('peak', 5)[0].cubics[0][3][0]) < 0.06 * box.r);
});

test('cuts reach about half the box, the box grows to hold them and the name sits below the deepest', () => {
  assert.equal(bandOf(house.cut_forms.spire), 0.65);
  assert.equal(bandOf(house.cut_forms.ring.filter((p: any) => p.at[0] === 'b')), 0);
  const h = boxHeight(house.cut_forms.peak, 16, 10, 3);
  assert.ok(h > 34 && Math.abs(0.55 * h + 3 + 16 + 10 - h) < 1e-9);
  assert.ok(GROWN.not_started < GROWN.finished);
});

test('the item is filled in the accent of its phase, the box outlined once more over it, and the presets name every dial', () => {
  const step = { id: 's', w: 100, h: 60, shape: 'carved', lines: ['x'], line: 16 }, m = (tag: string, attrs: any = {}, ...kids: any[]) => [tag, attrs, ...kids];
  const style = { ...house, ...preset('canvas.cut_galapagos').props };
  const marks = (phase: string, type = 'task') => itemMarks({ g: grammar(style), n: step, at: [50, 30], phase, item: { id: 'e_x', type }, z: () => 3, outline: () => m('rect', { class: 'lf-shape' }), m, corner: 6, dotAt: [0, 0] }).over;
  assert.equal(grammar(style).dot, false);
  assert.match(marks('under_way')[0][1].class, /lf-cut-52a5e0/);
  assert.match(marks('trouble')[0][1].class, /lf-cut-94341c/);
  assert.match(marks('under_way').at(-1)[1].class, /lf-edge/);
  assert.equal(marks('under_way', 'work').length, 3);
  for (const id of ['canvas.cut_galapagos', 'canvas.cut_faroe', 'canvas.cut_grow']) {
    const p = preset(id).props;
    assert.equal(preset(id).over, 'chosen');
    for (const k of ['cut_depth', 'cut_tension', 'cut_clear', 'cut_edge', 'cut_colours', 'type_cuts']) assert.ok(k in p, `${id} ${k}`);
    assert.ok(Object.values(p.type_shapes).every((s) => s === 'carved'));
  }
  assert.equal(preset('canvas.cut_grow').props.cut_grow, true);
  assert.ok('flow_cut_pad' in house.sizes);
});
