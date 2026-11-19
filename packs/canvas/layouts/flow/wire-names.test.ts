// Link names ride on the wires and give way (round 6, pass 14): the convex overlap test, the longest run, the order names
// are laid out in, and what gives way.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// @ts-ignore a page module, untyped
import { boxOf, longestRun, nameOf, namesShown, nameTransform, overlap, wireRules } from './wire-names.js';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'pack.json'), 'utf8'));
const waymark = pack.styles.find((s: any) => s.id === 'canvas.waymark').props;
const square = (x: number, y: number, s: number) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const width = (t: string) => t.length * 6, height = 14;

test('two convex shapes overlap where no axis parts them, a wire segment included', () => {
  assert.equal(overlap(square(0, 0, 10), square(5, 5, 10)), true);
  assert.equal(overlap(square(0, 0, 10), square(10, 0, 10)), false, 'touching is not meeting');
  assert.equal(overlap(square(0, 0, 10), square(20, 20, 5)), false);
  assert.equal(overlap([[-5, 5], [15, 5]], square(0, 0, 10)), true, 'a wire through a box');
  assert.equal(overlap([[-5, 50], [15, 50]], square(0, 0, 10)), false);
});

test("a name rides on its wire's longest run, never upside down", () => {
  const run = longestRun([[0, 0], [10, 0], [10, 100], [60, 100]]);
  assert.deepEqual([run.x, run.y, run.len], [10, 50, 100]);
  assert.ok(run.turn > -90 && run.turn <= 90);
  assert.equal(longestRun([[10, 0], [0, 0]]).turn, 0, 'a run drawn leftward is read left to right');
  assert.equal(nameOf('depends_on'), 'depends on');
  assert.equal(nameOf('core.is_part_of'), 'is part of');
  assert.match(nameTransform({ x: 5, y: 6, turn: 0 }, 1), /^translate\(5 6\) rotate\(0\) scale\(1\)$/);
  assert.equal(boxOf({ x: 0, y: 0, turn: 0 }, 20, 10, 2).length, 4);
});

test("names are laid out lit first, then the order's, then the longer; one that would meet another gives way", () => {
  const wires = [
    { id: 'short', points: [[20, 10], [80, 10]], order: false, text: 'part of' },
    { id: 'order', points: [[0, 0], [100, 0]], order: true, text: 'depends on' },
    { id: 'long', points: [[0, 300], [200, 300]], order: false, text: 'is about' },
  ];
  const { shown } = namesShown({ wires, boxes: [], width, height, pad: 2, f: 1 });
  assert.ok(shown.has('order'), 'the order first');
  assert.ok(!shown.has('short'), 'part of would run into the order wire and its name');
  assert.ok(shown.has('long'), 'the far one has room');
  const lit = namesShown({ wires: wires.map((x) => (x.id === 'short' ? { ...x, lit: true } : x)), boxes: [], width, height, pad: 2, f: 1 });
  assert.ok(lit.shown.has('short'), 'a lit wire always shows its name');
});

test('a name gives way to a board and to a wire not its own, and returns where zoomed in', () => {
  const a = { id: 'a', points: [[0, 0], [100, 0]], order: false, text: 'is about' };
  const b = { id: 'b', points: [[50, -30], [50, 30]], order: false, text: 'bears on' };
  const crossing = namesShown({ wires: [a, b], boxes: [], width, height, pad: 2, f: 1 });
  assert.ok(!crossing.shown.has('a') || !crossing.shown.has('b'), 'a wire across a name stops one of them');
  assert.ok(!namesShown({ wires: [a], boxes: [square(30, -10, 40)], width, height, pad: 2, f: 1 }).shown.has('a'), 'a board in the way');
  const near = { id: 'c', points: [[0, 0], [30, 0]], order: false, text: 'is about' };
  assert.ok(!namesShown({ wires: [near], boxes: [], width, height, pad: 2, f: 1 }).shown.has('c'), 'a run too short for its name');
  assert.ok(namesShown({ wires: [near], boxes: [], width, height, pad: 2, f: 0.5 }).shown.has('c'), 'zoomed in it fits');
});

test('the waymark preset draws ink wires with names, and its css says so', () => {
  assert.equal(waymark.ink_wires, true);
  assert.equal(waymark.wire_names, true);
  assert.equal(waymark.link_colours, undefined);
  assert.match(wireRules(waymark), /--ln-flow-wire-ink/);
  assert.match(wireRules(waymark), /lf-wn-quiet/);
  assert.equal(wireRules({}), '');
  const house = pack.styles.find((s: any) => s.id === 'core.house').props;
  for (const k of ['flow_wire_ink', 'flow_wire_name_text', 'flow_wire_name_pad', 'flow_wire_name_knock', 'flow_wire_name_leading', 'flow_wire_name_zoom_least', 'flow_wire_name_rescale']) assert.ok(k in house.sizes, k);
  assert.ok(house.sizes.flow_wire_name_text >= 11);
});

test('pass 15: a wire hovered lights, shows its name whatever the rule said, and its name is drawn last', async () => {
  const { copyFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const root = join(import.meta.dirname, '..', '..'), laid = mkdtempSync(join(tmpdir(), 'pelago-hover-'));
  for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(root, file as string), join(laid, name));
  const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
  const house = pack.styles.find((s: any) => s.id === 'core.house').props;
  const style = { ...house, ...waymark, shape: 'flow', sizes: { ...house.sizes, ...waymark.sizes } };
  const ids = ['e_aaaaaaaa', 'e_bbbbbbbb', 'e_cccccccc', 'e_dddddddd'];
  const items = ids.map((id, k) => ({ id, type: 'task', is: ['work'], title: `Item ${k} with a longer name`, open: true, status: 'doing', phase: 'under_way' }));
  const links = [['b', 'a'], ['c', 'a'], ['d', 'b'], ['d', 'c']].map(([f, to], k) => ({ id: `r_${k}`, type: 'depends_on', from: `e_${f.repeat(8)}`, to: `e_${to.repeat(8)}` }));
  const out = picture({ answer: { items, links }, style, width: 700, height: 500 }, { measure: (s: string, px: number) => s.length * px * 0.55 });
  const walk = (x: any): string[] => (Array.isArray(x) ? (typeof x[0] === 'string' ? [x[1]?.key ?? '', ...x.slice(2).flatMap(walk)] : x.flatMap(walk)) : []);
  const keys = walk(out.scene.svg);
  const hits = keys.filter((k: string) => k.startsWith('wh:')), names = keys.filter((k: string) => k.startsWith('wn:'));
  assert.equal(hits.length, links.length, 'each wire has a hit area');
  assert.ok(names.length > 0);
  const lastStep = Math.max(...keys.map((k: string, i: number) => (k.startsWith('s:') ? i : -1)));
  assert.ok(keys.indexOf(names[0]) > lastStep, 'names are drawn above the boards');
  assert.ok(keys.indexOf(hits[0]) < keys.findIndex((k: string) => k.startsWith('s:')), 'hit areas lie under the boards');
  const patches = out.on({ name: 'enter', key: hits[0] });
  assert.ok(patches.some((p: any) => p.key === 'w:0' && p.toggle?.lit === true), 'the wire lights');
  assert.ok(patches.some((p: any) => p.key === 'wn:0' && p.toggle?.['lf-wn-force'] === true), 'its name shows');
  assert.ok(patches.some((p: any) => p.key === 'wn:1' && p.toggle?.['lf-wn-force'] === false), 'the others stay as the rule said');
  assert.ok(out.on({ name: 'leave', key: hits[0] }).every((p: any) => !p.toggle?.['lf-wn-force'] && !p.toggle?.lit), 'on leave it goes back');
  assert.match(out.scene.css, /\.lf-hit/);
});
