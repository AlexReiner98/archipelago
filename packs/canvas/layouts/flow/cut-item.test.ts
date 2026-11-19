// A box cut by a mountain curve, pass 2 (round 6, screen e_vm8eg36x): two primitives, one tension, no kinks.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// @ts-ignore a page module, untyped
import { bandOf, bandsFor, boxHeight, cuts, GROWN, inset, listOf, ROLES, runsOf, STATUS_WORDS } from './cut-item.js';
// @ts-ignore a page module, untyped
import { grammar, itemMarks, itemRules, swatchRows } from './item-look.js';

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
  assert.equal(cutOf('twin').length, 1);
  assert.equal(cutOf('twin')[0].cubics.length, 4);
  assert.equal(cutOf('ring').length, 2);
});

test('a list in a type, or a name, gives the same cut; a flavour takes its starter\'s', () => {
  const cut = { types: { task: 'slope', work: [{ at: 0.5, w: 0.3, d: 0.4 }] }, forms: house.cut_forms };
  assert.deepEqual(listOf(cut, {}, ['task']), house.cut_forms.slope);
  assert.equal(listOf(cut, {}, ['mytask', 'work']).length, 1);
});

test('no kinks: every curve meets the box edge, and its neighbour, along the same tangent', () => {
  for (const name of Object.keys(house.cut_forms)) for (const seed of [1, 2, 3]) for (const region of cutOf(name, seed)) {
    const c = region.cubics;
    if (c.length > 1) {
      // A skyline: level at each foot and at each summit, where two halves share a point their handles are level too.
      for (const [i, seg] of c.entries()) {
        assert.ok(near(seg[0][1], seg[1][1]) && near(seg[2][1], seg[3][1]), `${name} level at both ends of a half`);
        if (i) assert.ok(near(c[i - 1][3][1], seg[0][1]), `${name} halves join, or by a level saddle`);
      }
      const peak = Math.min(...c.map((seg: number[][]) => seg[3][1]));
      assert.ok(near(peak, box.t), `${name} a summit touches the top edge`);
    } else {
      // A corner arc: along the side where it starts, along the top or foot where it ends.
      const [p0, p1, p2, p3] = c[0], [u, v] = [unit(p0, p1), unit(p2, p3)];
      assert.ok(near(u[0], 0) && near(Math.abs(u[1]), 1), `${name} leaves the side along it`);
      assert.ok(near(v[1], 0) && near(Math.abs(v[0]), 1), `${name} meets the edge along it`);
    }
    for (const seg of c) for (const [x, y] of seg) assert.ok(x >= box.l - 1e-6 && x <= box.r + 1e-6 && y >= box.t - 1e-6 && y <= box.b + 1e-6, `${name} inside`);
  }
});

test('a cut never comes below the top of the name, whatever the lines', () => {
  const [pad, clear, line] = [10, 7, 16];
  for (const name of Object.keys(house.cut_forms)) for (const lines of [1, 2, 3]) for (const seed of [1, 9]) {
    const list = house.cut_forms[name], h = boxHeight(list, lines * line, pad, clear), tall = { l: 0, t: 0, r: 160, b: h }, textTop = h - pad - lines * line;
    for (const region of cuts(tall, list.filter((p: any) => p.at[0] !== 'b'), { rx: 6, tension: 0.75, seed })) for (const seg of region.cubics) for (const [, y] of seg) assert.ok(y <= textTop - clear + 1e-6, `${name} ${lines} lines: ${y} > ${textTop}`);
  }
});

test('a pack names its cut with the primitives: two summits make one skyline with a saddle', () => {
  const [region] = cuts(box, [{ at: 0.25, w: 0.4, d: 0.5 }, { at: 0.75, w: 0.4, d: 0.5 }], { rx: 6, tension: 0.75, seed: 1 });
  assert.equal(region.cubics.length, 4);
  assert.ok(region.cubics.every((seg: number[][]) => seg.every(([, y]) => y >= box.t - 1e-6)));
});

test('one tension: a tighter one pulls the handles in, everywhere', () => {
  const at = (k: number) => cuts(box, house.cut_forms.peak, { rx: 6, tension: k, seed: 1 })[0].cubics[0];
  assert.ok(Math.abs(at(0.3)[1][0] - at(0.3)[0][0]) < Math.abs(at(0.55)[1][0] - at(0.55)[0][0]));
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

test('a palette makes runs, a phase picks one and the type a colour in it, in nested bands', () => {
  const runs = runsOf(house.ridge_palettes.faroe);
  assert.ok(Object.values(runs).every((r: any) => r.length > 0));
  assert.ok(runs.pale.every((c: string) => !runs.deep.includes(c)));
  assert.deepEqual(bandsFor(runs, 'finished', 0, 3).every((c: string) => runs.deep.includes(c)), true);
  assert.deepEqual(bandsFor(runs, 'trouble', 0, 2).every((c: string) => runs.accent.includes(c)), true);
  assert.notEqual(bandsFor(runs, 'under_way', 0, 1)[0], bandsFor(runs, 'under_way', 1, 1)[0]);
  const inner = inset(house.cut_forms.peak, 1, 0.22)[0], outer = house.cut_forms.peak[0];
  assert.ok(inner.w === outer.w && inner.d < outer.d && inner.at === outer.at);
  for (const k of ['faroe', 'galapagos', 'svalbard', 'hawaii', 'cyclades']) assert.ok(house.ridge_palettes[k].colours.length >= 9, k);
});

test('the item is banded in its phase run, the box outlined once more over it, the key shows the palette, and the presets name every dial', () => {
  const step = { id: 's', w: 100, h: 60, shape: 'carved', lines: ['x'], line: 16 }, m = (tag: string, attrs: any = {}, ...kids: any[]) => [tag, attrs, ...kids];
  const style = { ...house, ...preset('canvas.cut_faroe').props };
  const marks = (phase: string, type = 'task') => itemMarks({ g: grammar(style), n: step, at: [50, 30], phase, item: { id: 'e_x', type }, z: () => 3, outline: () => m('rect', { class: 'lf-shape' }), m, corner: 6, dotAt: [0, 0] }).over;
  assert.equal(grammar(style).dot, false);
  assert.equal(marks('under_way').length, 4);
  assert.notEqual(marks('under_way')[0][1].class, marks('under_way')[1][1].class);
  assert.notEqual(marks('finished')[0][1].class, marks('not_started')[0][1].class);
  assert.match(marks('under_way').at(-1)[1].class, /lf-edge/);
  const key = swatchRows(grammar(style).cut, { m, w: 22, h: 14, roles: ROLES });
  assert.equal(key.rows.length, 5);
  assert.ok(key.rules.length >= 5);
  for (const id of ['canvas.cut_galapagos', 'canvas.cut_faroe', 'canvas.cut_grow', 'canvas.cut_svalbard', 'canvas.cut_hawaii', 'canvas.cut_cyclades']) {
    const p = preset(id).props;
    assert.equal(preset(id).over, 'chosen');
    for (const k of ['cut_depth', 'cut_tension', 'cut_clear', 'cut_edge', 'cut_palette', 'cut_bands', 'cut_inset', 'type_cuts']) assert.ok(k in p, `${id} ${k}`);
    assert.ok(house.ridge_palettes[p.cut_palette], id);
    assert.ok(Object.values(p.type_shapes).every((s) => s === 'carved'));
  }
  assert.equal(preset('canvas.cut_grow').props.cut_grow, true);
  assert.ok('flow_cut_pad' in house.sizes);
});

test('pass 4: one colour per item by status, a small cut, and every box the same height', () => {
  const style = { ...house, ...preset('canvas.status_field').props };
  const g = grammar(style), step = { id: 's', w: 100, h: 41, shape: 'carved', lines: ['x'], line: 16 }, m = (tag: string, attrs: any = {}, ...kids: any[]) => [tag, attrs, ...kids];
  const over = (phase: string, status = 'todo', type = 'task') => itemMarks({ g, n: step, at: [50, 20], phase, item: { id: 'e_x', type, status }, z: () => 3, outline: () => m('rect', { class: 'lf-shape' }), m, corner: 6, dotAt: [0, 0] }).over;
  assert.equal(over('under_way').length, 2);
  assert.match(over('under_way')[0][1].class, /lf-cut-s-under_way/);
  assert.match(over('under_way', 'waiting')[0][1].class, /lf-cut-s-waiting/);
  assert.match(over('finished', 'waiting')[0][1].class, /lf-cut-s-finished/);
  assert.match(over('trouble')[0][1].class, /lf-cut-s-trouble/);
  assert.equal(over('ended').length, 1);
  const css = itemRules(style);
  for (const k of ['not_started', 'under_way', 'waiting', 'finished', 'trouble']) assert.match(css, new RegExp('lf-cut-s-' + k + '[^}]*light-dark[(]#[0-9a-f]{6}, #[0-9a-f]{6}[)]'));
  // The same height for every type; no cut over a quarter of it.
  const heights = new Set(Object.keys(house.cut_forms).map(() => boxHeight([{ d: style.cut_most }], 16, 10, style.cut_clear)));
  assert.equal(heights.size, 1);
  const h = [...heights][0] as number, tall = { l: 0, t: 0, r: 160, b: h };
  for (const name of Object.keys(house.cut_forms)) for (const region of cuts(tall, house.cut_forms[name], { rx: 6, tension: 0.75, scale: style.cut_depth, most: style.cut_most, seed: 3 })) for (const seg of region.cubics) for (const [, y] of seg) assert.ok(y <= 0.25 * h + 6, `${name} ${y} of ${h}`);
  const key = swatchRows(g.cut, { m, w: 22, h: 14, roles: ROLES, words: STATUS_WORDS });
  assert.deepEqual(key.rows.map((r: any) => r.label), ['To do', 'In progress', 'Waiting', 'Done', 'Blocked']);
  for (const id of ['canvas.status_field', 'canvas.status_ochre', 'canvas.status_clear']) {
    const p = preset(id).props;
    assert.equal(p.cut_bands, 1);
    for (const k of ['not_started', 'under_way', 'waiting', 'finished', 'trouble']) assert.ok(p.status_colours[k].light && p.status_colours[k].dark, `${id} ${k}`);
  }
});

test('pass 5: a type by its outline, the status colour only in a piece of it', async () => {
  // @ts-ignore a page module, untyped
  const { cap, chamfer, flap, fold, hut, outlineOf, summit, tabStrip } = await import('./type-outline.js');
  // @ts-ignore a page module, untyped
  const { landOn } = await import('./shapes.js');
  assert.match(chamfer(0, 0, 100, 40, 9), /^M9 0H91L100 9V40H0V9Z$/);
  assert.match(fold(0, 0, 100, 40, 13), /^M0 0H87L100 13V40H0Z$/);
  assert.match(flap(100, 0, 13), /^M87 0L100 13H87Z$/);
  assert.match(tabStrip(0, 0, 90, 8), /^M0 0H30L38 8H0Z$/);
  const s = summit({ l: 0, t: 0, r: 100, b: 54, rise: 14, span: 0.4, tension: 0.75 });
  assert.deepEqual(s.cubics[0][3], s.cubics[1][0]);
  assert.equal(s.cubics[0][3][1], 0);
  assert.ok(s.cubics.every((c: number[][]) => c[0][1] === c[1][1] || c[2][1] === c[3][1]));
  assert.ok(s.outline.endsWith('V54H0Z') && s.fill.endsWith('Z'));
  assert.equal(outlineOf('box', 0, 0, 1, 1, 3), null);
  assert.match(hut({ l: 0, t: 0, r: 100, b: 50, rise: 8 }).outline, /^M0 8L50 0L100 8V50H0Z$/);
  assert.match(cap('band', 0, 100, 0, 8), /^M0 0H100V8H0Z$/);
  assert.doesNotMatch(cap('arc', 0, 100, 0, 8), /C/);
  assert.equal(landOn({ shape: 'hut', w: 100, h: 58, bevel: 8 }, 50, 29, [10, 0], [10, -9])[1], 8);
  assert.equal(preset('canvas.status_field').props.sizes.flow_point, 7);
  // The same height whatever the outline: carved, chamfer, hexagon... each type of the preset has one of the shapes.
  const shapes = preset('canvas.status_field').props.type_shapes;
  assert.deepEqual([shapes.task, shapes.work, shapes.question, shapes.aim, shapes.occurrence, shapes.record, shapes.place], ['carved', 'flag', 'hexagon', 'summit', 'pill', 'fold', 'hut']);
  // Wires land on the real outline: on a chamfer's cut corner, a fold's, and below a summit's rise.
  const box = { shape: 'chamfer', w: 100, h: 40, bevel: 10 };
  assert.equal(landOn(box, 50, 20, [0 + 52, 0], [52, -9])[1], 0);
  assert.equal(landOn(box, 50, 20, [3, 0], [3, -9])[1], 0 + 7);
  assert.equal(landOn({ shape: 'fold', w: 100, h: 40, bevel: 10 }, 50, 20, [98, 0], [98, -9])[1], 8);
  assert.equal(landOn({ shape: 'summit', w: 100, h: 54, bevel: 14 }, 50, 27, [10, 0], [10, -9])[1], 14);
});
