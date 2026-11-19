// A box cut by a mountain curve (round 6, screen e_vm8eg36x): each kind's cut, seeded by the item, kept above the name.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// @ts-ignore a page module, untyped
import { cutPath, depthFor, DEEP } from './cut-item.js';
// @ts-ignore a page module, untyped
import { grammar, itemMarks } from './item-look.js';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'pack.json'), 'utf8'));
const house = pack.styles.find((s: any) => s.id === 'core.house').props;
const preset = (id: string) => pack.styles.find((s: any) => s.id === id);
const box = { l: 0, t: 0, r: 100, b: 34 };
const cut = (kind: string, seed = 1, depth = 7) => cutPath(box, kind, { rx: 6, depth, soft: 0.5, seed });

test('every kind makes a closed path of its own, the same for the same seed', () => {
  const paths = Object.keys(DEEP).map((k) => cut(k));
  for (const d of paths) assert.match(d, /^M.*Z$/);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(cut('slope', 3), cut('slope', 3));
  assert.notEqual(cut('slope', 3), cut('slope', 4));
  assert.equal(cut('nothing'), '');
});

test('twin cuts two corners and ring four', () => {
  assert.equal(cut('twin').split('M').length, 3);
  assert.equal(cut('ring').split('M').length, 5);
});

test('a cut is as deep as the style says, kept above the name, and grows with progress where asked', () => {
  const base = { depth: 7, clear: 3, h: 34, lines: 1, line: 16 };
  assert.equal(depthFor({ ...base, grow: false, phase: 'finished' }), 6);
  assert.equal(depthFor({ ...base, depth: 4, grow: false, phase: 'finished' }), 4);
  assert.ok(depthFor({ ...base, depth: 4, grow: true, phase: 'not_started' }) < depthFor({ ...base, depth: 4, grow: true, phase: 'finished' }));
});

test('the item is filled in the accent of its phase, and the presets name every dial', () => {
  const step = { id: 's', w: 100, h: 34, shape: 'carved', lines: ['x'], line: 16 }, m = (tag: string, attrs: any = {}, ...kids: any[]) => [tag, attrs, ...kids];
  const style = { ...house, ...preset('canvas.cut_galapagos').props };
  const marks = (phase: string, type = 'task') => itemMarks({ g: grammar(style), n: step, at: [50, 17], phase, item: { id: 'e_x', type }, z: () => 3, outline: () => [], m, corner: 6, dotAt: [0, 0] });
  assert.equal(grammar(style).dot, false);
  assert.match(marks('under_way').over[0][1].class, /lf-cut-52a5e0/);
  assert.match(marks('trouble').over[0][1].class, /lf-cut-94341c/);
  assert.notEqual(marks('under_way', 'work').over[0][1].d, marks('under_way').over[0][1].d);
  for (const id of ['canvas.cut_galapagos', 'canvas.cut_faroe', 'canvas.cut_grow']) {
    const p = preset(id).props;
    assert.equal(preset(id).over, 'chosen');
    for (const k of ['cut_depth', 'cut_soft', 'cut_clear', 'cut_colours', 'type_cuts']) assert.ok(k in p, `${id} ${k}`);
    assert.ok(Object.values(p.type_shapes).every((s) => s === 'carved'));
  }
  assert.equal(preset('canvas.cut_grow').props.cut_grow, true);
});
