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

test('pass 6: markers by outline, one band of paint each, the same size for every type', async () => {
  // @ts-ignore a page module, untyped
  const { areaOf, bandPoints, chamfer, fold, hut, outlineOf } = await import('./type-outline.js');
  // @ts-ignore a page module, untyped
  const { landOn } = await import('./shapes.js');
  assert.match(chamfer(0, 0, 100, 40, 9), /^M9 0H91L100 9V40H0V9Z$/);
  assert.match(fold(0, 0, 100, 40, 13), /^M0 0H87L100 13V40H0ZM87 0V13H100$/);
  assert.match(hut({ l: 0, t: 0, r: 100, b: 50, rise: 8 }).outline, /^M0 8L50 0L100 8V50H0Z$/);
  assert.equal(outlineOf('summit', 0, 0, 100, 54, 9), 'M0 9H100V45H0Z');
  assert.equal(outlineOf('box', 0, 0, 1, 1, 3), null);
  const shapes = preset('canvas.status_field').props.type_shapes;
  assert.deepEqual([shapes.task, shapes.work, shapes.question, shapes.aim, shapes.occurrence, shapes.record, shapes.place], ['carved', 'flag', 'hexagon', 'summit', 'pill', 'fold', 'hut']);
  // The same painted area for every type at equal width (within 15 percent).
  const sizes = preset('canvas.status_field').props.sizes, h = 41, d = 0.2 * h, w = 150;
  const areas = Object.entries({ carved: { k: 0, rx: 6 }, flag: { k: sizes.flow_point }, hexagon: { k: sizes.flow_point }, pill: { k: 0 }, fold: { k: 13 }, hut: { k: sizes.flow_hut } }).map(([shape, o]: any) => [shape, areaOf(bandPoints(shape, { l: 0, t: 0, r: w, b: h, d, ...o }))]);
  const mean = areas.reduce((sum, [, a]: any) => sum + a, 0) / areas.length;
  for (const [shape, a] of areas as any) assert.ok(Math.abs(a - mean) / mean <= 0.15, `${shape} paints ${a} against ${mean}`);
  // Wires land on the real outline: a chamfer's corner, a fold's, down a roof, down a summit's slope and beside it.
  assert.equal(landOn({ shape: 'fold', w: 100, h: 40, bevel: 10 }, 50, 20, [98, 0], [98, -9])[1], 8);
  assert.equal(landOn({ shape: 'hut', w: 100, h: 50, bevel: 8 }, 50, 25, [50, 0], [50, -9])[1], 0);
  assert.equal(landOn({ shape: 'hut', w: 100, h: 50, bevel: 8 }, 50, 25, [0, 0], [0, -9])[1], 8);
  // The aim: beside its range a wire lands on the box top, over the range on the range's top, below it on the box's own foot.
  const aim = { shape: 'summit', w: 100, h: 72, bevel: 18, span: 0.7 };
  assert.equal(landOn(aim, 50, 36, [5, 0], [5, -9])[1], 18);
  assert.equal(landOn(aim, 50, 36, [60, 0], [60, -9])[1], 0);
  assert.equal(landOn(aim, 50, 36, [60, 72], [60, 90])[1], 54);
  assert.equal(sizes.flow_summit, 22);
  assert.equal(preset('canvas.status_field').props.item_state, 'none');
});

test('pass 7: the aim is a seeded range of layers, the front its status colour', async () => {
  // @ts-ignore a page module, untyped
  const { rangeLayers, rangeMarks } = await import('./aim-range.js');
  const form = house.ridge_forms[house.type_forms.aim], m = (tag: string, attrs: any = {}, ...kids: any[]) => [tag, attrs, ...kids];
  const a = rangeLayers('e_aaaaaaaa', form, 22), b = rangeLayers('e_bbbbbbbb', form, 22);
  assert.deepEqual(a, rangeLayers('e_aaaaaaaa', form, 22));
  assert.notDeepEqual(a, b);
  assert.equal(a.length, 3);
  const marks = rangeMarks({ id: 'e_aaaaaaaa', form, x0: 10, x1: 90, base: 20, rise: 18, word: 'under_way', m, cols: 22 });
  assert.equal(marks.length, 6);
  assert.match(marks[4][1].class, /lf-cut-s-under_way/);
  assert.match(marks[0][1].class, /lf-range-1/);
  assert.ok(marks.every((k: any) => !/NaN/.test(k[1].d ?? '')));
  const top = Math.min(...marks.flatMap((k: any) => (k[1].d.match(/ (-?\d+(?:\.\d+)?)/g) ?? []).map(Number)));
  assert.ok(top >= 20 - 18 - 4, `rises ${20 - top}`);
  assert.ok(rangeMarks({ id: 'e_x', form, x0: 0, x1: 80, base: 20, rise: 18, word: 'ended', m, cols: 22 }).every((k: any) => /bare|ink/.test(k[1].class)));
});

test('pass 9: a board painted whole in its status colour, the outline the only type signal', async () => {
  // @ts-ignore a page module, untyped
  const { contrast, crossPath } = await import('./waymark.js');
  // @ts-ignore a page module, untyped
  const { arrow, forward, outlineOf, roundEnd, roundStart, swallow } = await import('./type-outline.js');
  // @ts-ignore a page module, untyped
  const { landOn } = await import('./shapes.js');
  const p = preset('canvas.waymark').props;
  // The name reads on every fill, in both themes.
  for (const [status, f] of Object.entries(p.board_fills) as [string, any][]) for (const t of ['light', 'dark']) assert.ok(contrast(f[t].fill, f[t].text) >= 4.5, `${status} ${t}: ${contrast(f[t].fill, f[t].text).toFixed(2)}`);
  assert.deepEqual(Object.keys(p.board_fills), ['not_started', 'under_way', 'waiting', 'finished', 'trouble']);
  // Seven outlines, all different, each end 9 deep.
  const shapes = p.type_shapes;
  assert.deepEqual([shapes.task, shapes.work, shapes.question, shapes.occurrence, shapes.record, shapes.place, shapes.aim], ['flag', 'forward', 'hexagon', 'roundend', 'plank', 'roundstart', 'pennant']);
  const paths = ['flag', 'forward', 'hexagon', 'roundend', 'plank', 'roundstart', 'pennant'].map((w) => outlineOf(w, 0, 0, 100, 30, 9) ?? w);
  assert.equal(new Set(paths.slice(1, 2).concat(paths.slice(3, 6))).size, 4);
  assert.equal(forward(0, 0, 100, 30, 9), 'M0 0H91L100 15L91 30H0L9 15Z');
  assert.equal(roundStart(0, 0, 100, 30, 9), 'M9 0H100V30H9A9 15 0 0 1 9 0Z');
  assert.equal(arrow(0, 0, 100, 30, 9), 'M0 0H91L100 15L91 30H0Z');
  assert.match(roundEnd(0, 0, 100, 30, 9), /A9 15 0 0 1/);
  assert.match(swallow(0, 0, 100, 30, 9), /^M0 0H100L91 15L100 30H0Z$/);
  assert.equal(p.sizes.flow_board_extra, 6);
  // No plates any more: the preset names none.
  assert.equal(p.type_signs, undefined);
  assert.match(crossPath(0, 0, 10), /^M0 0l10 10M10 0l-10 10$/);
  // Wires land on the real outline: a forward board's notch, a round start's curve, the tall arrow's point.
  assert.equal(landOn({ shape: 'forward', w: 100, h: 30, bevel: 9 }, 50, 15, [0, 15], [-20, 15])[0], 9);
  assert.equal(landOn({ shape: 'roundstart', w: 100, h: 30, bevel: 9 }, 50, 15, [0, 15], [-20, 15])[0], 0);
  assert.equal(landOn({ shape: 'tallarrow', w: 100, h: 36, bevel: 9 }, 50, 18, [100, 18], [120, 18])[0], 100);
  for (const k of ['flow_sign', 'flow_sign_gap', 'flow_sign_margin', 'flow_board_height', 'flow_end_depth', 'flow_board_extra']) assert.ok(k in house.sizes, k);
});

test('pass 10: a strip says who holds the item', async () => {
  // @ts-ignore a page module, untyped
  const { contrast, holdersOf, whoText } = await import('./waymark.js');
  const p = preset('canvas.waymark').props;
  assert.equal(p.who_strip, true);
  assert.equal(p.sizes.flow_board_height, undefined, 'one uniform board height: the plate hangs below');
  assert.ok(p.sizes.flow_pennant >= 14 && p.sizes.flow_pennant <= 16);
  assert.ok(p.sizes.flow_end_depth <= 10 && house.sizes.flow_who_text >= 11);
  assert.ok('flow_who' in house.sizes && 'flow_who_text' in house.sizes && 'flow_who_most' in house.sizes);
  const item = { id: 'e_x', owner: 'e_sam', sessions: [{ title: 'Round 6 lane' }, { title: 'Spec check' }], holders: [{ how: 'works', id: 'e_alex', name: 'alex@aperture.tools' }] };
  const list = holdersOf(item, 'under_way', 'e_alex');
  assert.deepEqual(list.map((h: any) => [h.kind, h.name]), [['session', 'Round 6 lane'], ['session', 'Spec check'], ['human', 'you'], ['human', 'owner']]);
  assert.equal(list[2].you, true);
  assert.equal(whoText(list, 16), 'Round 6 lane +3');
  assert.equal(whoText([{ kind: 'human', name: 'alexandra@aperture.tools' }], 12), 'alexandra');
  assert.equal(whoText([{ kind: 'session', name: 'A very long session title indeed' }], 10), 'A very lo…');
  assert.deepEqual(holdersOf({ id: 'e_y', holders: [{ how: 'waits', id: 'e_sam', name: 'Sam' }] }, 'waiting', 'e_alex').map((h: any) => h.name), ['Sam']);
  assert.deepEqual(holdersOf({ id: 'e_z', sessions: [{ title: 's' }] }, 'finished', 'e_alex'), []);
  assert.deepEqual(holdersOf({ id: 'e_z' }, 'under_way', 'e_alex'), []);
  // The text on the strip, a deeper tone (82 percent of the board's fill, the rest black), still reads at 4.5 to 1.
  const mixed = (hex: string) => '#' + [1, 3, 5].map((k) => Math.round(parseInt(hex.slice(k, k + 2), 16) * 0.82).toString(16).padStart(2, '0')).join('');
  for (const [status, f] of Object.entries(p.board_fills) as [string, any][]) for (const t of ['light', 'dark']) assert.ok(contrast(mixed(f[t].fill), f[t].text) >= 4.5, `${status} ${t} strip ${contrast(mixed(f[t].fill), f[t].text).toFixed(2)}`);
});

test('pass 12: a board with a plate has room for it, and no plate overlaps another item', async () => {
  const { copyFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const root = join(import.meta.dirname, '..', '..'), laid = mkdtempSync(join(tmpdir(), 'pelago-plates-'));
  for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(root, file as string), join(laid, name));
  const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
  const w = preset('canvas.waymark').props, style = { ...house, ...w, shape: 'flow', sizes: { ...house.sizes, ...w.sizes } };
  const task = (id: string, title: string, extra: any = {}) => ({ id, type: 'task', is: ['work'], title, open: true, status: 'doing', phase: 'under_way', ...extra });
  const answer = {
    items: [task('e_aaaaaaaa', 'Plated', { holders: [{ how: 'works', id: 'e_sam', name: 'sam' }] }), task('e_bbbbbbbb', 'Below it'), task('e_cccccccc', 'Plain beside'), task('e_dddddddd', 'Below the plain')],
    links: [{ id: 'r_1', type: 'depends_on', from: 'e_bbbbbbbb', to: 'e_aaaaaaaa' }, { id: 'r_2', type: 'depends_on', from: 'e_dddddddd', to: 'e_cccccccc' }],
  };
  const measure = (t: string, px: number) => t.length * px * 0.55;
  const { scene } = picture({ answer, style, width: 900, height: 700 }, { measure });
  const at = (id: string) => scene.places.find((p: any) => p.id === id);
  const room = house.sizes.flow_who + house.sizes.flow_who_gap, board = w.sizes.flow_board_height ?? house.sizes.flow_board_height;
  // Only the plated board has the extra room, as much above and below; the others stay as tight as before.
  assert.equal(at('e_aaaaaaaa').h, board + 2 * room);
  assert.equal(at('e_cccccccc').h, board);
  // Its plate hangs in the room below the board, so it is inside the node: the node below starts under it, and no two nodes overlap.
  const plate = { top: at('e_aaaaaaaa').y + board / 2 + house.sizes.flow_who_gap, bottom: at('e_aaaaaaaa').y + board / 2 + room };
  assert.ok(plate.bottom <= at('e_aaaaaaaa').y + at('e_aaaaaaaa').h / 2);
  for (const a of scene.places) for (const b of scene.places) if (a.id < b.id) assert.ok(Math.abs(a.x - b.x) * 2 >= a.w + b.w - 1e-6 || Math.abs(a.y - b.y) * 2 >= a.h + b.h - 1e-6, `${a.id} ${b.id} overlap`);
});
