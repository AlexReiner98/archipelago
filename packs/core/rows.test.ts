// The rows layout (packs/core/layouts/rows/): each step alone, a model in and its answer out, and the whole on a made-up
// map: rows only from the order, blocks of parts, right-angle wires that merge, nothing on top of anything.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a drawing's modules are plain JavaScript
import { blocksOf, wholesOf } from './layouts/rows/blocks.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { lengthsOf, rowsOf } from './layouts/rows/index.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { modelOf } from './layouts/rows/model.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { placed } from './layouts/rows/place.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { plansOf, whereOf } from './layouts/rows/plan.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { linesOf, ranksOf } from './layouts/rows/ranks.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { routed, simplified } from './layouts/rows/route.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { streetsOf } from './layouts/rows/streets.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { packed } from './layouts/rows/tracks.js';

const Z = lengthsOf(
  { rows_line_gap: 10, rows_indent: 24, rows_block_gap: 32, rows_lane: 10, rows_track: 10, rows_street_pad: 14, rows_street_least: 36, rows_straight: 0.5, rows_column_most: 200, flow_island_pad: 14, flow_island_name_room: 18, flow_island_sea: 72 },
  { rows_straighten: 4, flow_aspect: 1.6 },
);
const item = (id: string, made: number, island = 's') => ({ id, w: 100, h: 30, island, made: String(made).padStart(3, '0') });
const link = (from: string, to: string, type = 'depends_on') => ({ id: `${type} ${from} ${to}`, from, to, type, order: type === 'depends_on' });

test('tracks: runs that do not overlap share one, merged runs are one, and a nested run sits nearer than its holder', () => {
  const { track, count } = packed([{ key: 'a', lo: 0, hi: 10 }, { key: 'b', lo: 20, hi: 30 }, { key: 'c', lo: 5, hi: 25 }]);
  assert.equal(track.get('a'), track.get('b'));
  assert.notEqual(track.get('a'), track.get('c'));
  assert.equal(count, 2);
  assert.equal(packed([{ key: 'm', lo: 0, hi: 10 }, { key: 'm', lo: 40, hi: 50 }, { key: 'n', lo: 20, hi: 30 }]).count, 2);
  // The outer run's span holds both of the inner run's ends, each turning toward track 0: the inner must be nearer.
  const nested = packed([{ key: 'outer', lo: 0, hi: 100, ends: [{ at: 0, near: true }, { at: 100, near: true }] }, { key: 'inner', lo: 40, hi: 60, ends: [{ at: 40, near: true }, { at: 60, near: true }] }]);
  assert.ok(nested.track.get('inner') < nested.track.get('outer'));
});

test('blocks: a tree of parts is one block, its head first, its parts in columns no taller than the style allows', () => {
  const items = [item('h', 0), ...Array.from({ length: 6 }, (_, k) => item(`p${k}`, k + 1)), item('alone', 9)];
  const links = items.slice(1, 7).map((i) => link(i.id, 'h', 'part_of'));
  const blocks = blocksOf(items, links, Z);
  assert.deepEqual(blocks.map((b: any) => b.id), ['h', 'alone']);
  assert.ok(blocks[0].columns.length > 1, 'six parts are more than one column holds');
  for (const c of blocks[0].columns) assert.ok(c.h <= Z.column_most);
  // A loop of parts is cut: each item is part of at most one, and nothing is part of itself through others.
  const whole = wholesOf([item('x', 0), item('y', 1)], [link('x', 'y', 'part_of'), link('y', 'x', 'part_of')]);
  assert.equal(whole.size, 1);
});

test('rows: the longest path of the order; in a loop the link down to the block made earlier is the back edge', () => {
  const items = ['a', 'b', 'c', 'd'].map((id, k) => item(id, k));
  const blocks = blocksOf(items, [], Z), blockOf = new Map(items.map((i) => [i.id, i.id]));
  // b depends on a, c on b, d on a and c; a depends on c, closing a loop a -> b -> c -> a.
  const links = [link('b', 'a'), link('c', 'b'), link('d', 'a'), link('d', 'c'), link('a', 'c')];
  const r = ranksOf(blocks, links, blockOf);
  assert.deepEqual([...r.back], ['depends_on a c']);
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => r.row.get(id)), [0, 1, 2, 3]);
  assert.equal(r.rows, 4);
});

test('rows: a block that only starts paths sits just above the first it starts; unordered blocks wrap in lines below', () => {
  const items = ['a', 'b', 'c', 'late', 'f1', 'f2', 'f3'].map((id, k) => item(id, k));
  const blocks = blocksOf(items, [], Z), blockOf = new Map(items.map((i) => [i.id, i.id]));
  const r = ranksOf(blocks, [link('b', 'a'), link('c', 'b'), link('c', 'late')], blockOf);
  assert.equal(r.row.get('late'), 1);
  const rows = linesOf(blocks, r, () => 100, 250, 32);
  assert.deepEqual(['f1', 'f2', 'f3'].map((id) => r.row.get(id)), [3, 3, 4]);
  assert.equal(rows, 5);
});

test('plans: a block alone leaves by its top or foot, a part by its gutter; wires that skip rows cross on waypoints', () => {
  const items = [item('top', 0), item('mid', 1), item('low', 2), item('p', 3)];
  const links = [link('mid', 'top'), link('low', 'mid'), link('low', 'top'), link('p', 'low', 'part_of'), link('p', 'top', 'about')];
  const blocks = blocksOf(items, links, Z), blockOf = new Map(blocks.flatMap((b: any) => b.members.map((m: string) => [m, b.id])));
  const r = ranksOf(blocks, links, blockOf), plans = plansOf({ links, where: whereOf(blocks, r.row), back: r.back, rows: r.rows });
  const of = (id: string) => plans.find((p: any) => p.id === id);
  assert.equal(of('depends_on mid top').a.side, 'bottom');
  assert.equal(of('depends_on low top').b.side, 'top');
  assert.deepEqual(of('depends_on low top').rows, [1]);
  assert.equal(of('about p top').b.side, 'right');
  // The order's wires into one item merge.
  assert.equal(of('depends_on low top').merge.b, of('depends_on low mid').merge.b);
});

test('place: straightening moves an entry only rightward, pushing the rest of its row along, a fixed number of passes', () => {
  const rows = [[{ id: 'a', w: 100 }, { id: 'b', w: 300 }], [{ id: 'c', w: 100 }, { id: 'd', w: 100 }]];
  const told: string[] = [];
  const x = placed(rows, [{ up: 'b', upDx: 50, down: 'c', downDx: 50 }], Z, (name: string) => told.push(name));
  assert.equal(told.length, Z.straighten);
  assert.ok(x.get('c') > 0);
  assert.ok(x.get('d') >= x.get('c') + 100 + Z.gap);
  assert.equal(x.get('a'), 0);
});

test('streets and route: a street is as tall as its tracks, and every wire turns at right angles', () => {
  const box = { x: 0, y: 0, w: 100, h: 30 };
  const wires = [
    { id: 'w1', a: { side: 'bottom', row: 0, box, x: 50 }, b: { side: 'top', row: 1, box: { ...box, x: 200 }, x: 250 }, street: 1, merge: {}, stops: [50, 250] },
    { id: 'w2', a: { side: 'bottom', row: 0, box, x: 60 }, b: { side: 'top', row: 1, box: { ...box, x: 200 }, x: 240 }, street: 1, merge: {}, stops: [60, 240] },
  ];
  const s = streetsOf([30, 30], wires, Z);
  assert.equal(s.streetH[1], 2 * Z.pad + Z.track);
  for (const w of wires) {
    const points = routed({ ...w, track: s.track.get(w.id) }, s.rowY);
    for (let k = 1; k < points.length; k++) assert.ok(points[k][0] === points[k - 1][0] || points[k][1] === points[k - 1][1]);
  }
  assert.deepEqual(simplified([[0, 0], [0, 5], [0, 10], [10, 10], [10, 10]]), [[0, 0], [0, 10], [10, 10]]);
});

test('the whole: islands framed, no two boxes overlap, every wire at right angles, every step told', () => {
  const measure = (t: string) => t.length * 7;
  const sizes = { flow_max_text: 140, flow_text: 13, flow_box_pad: 42, flow_box_height: 34, flow_line_height: 16 };
  const answer = {
    items: [
      ...['a', 'b', 'c', 'd', 'e'].map((id, k) => ({ id, title: `Item ${id}`, island: 'one', created_at: `2026-11-0${k + 1}` })),
      ...['x', 'y', 'z'].map((id, k) => ({ id, title: `Item ${id}`, island: 'two', created_at: `2026-11-0${k + 1}` })),
    ],
    links: [
      { id: 'l1', type: 'depends_on', from: 'b', to: 'a' }, { id: 'l2', type: 'depends_on', from: 'c', to: 'b' }, { id: 'l3', type: 'part_of', from: 'e', to: 'd' },
      { id: 'l4', type: 'about', from: 'e', to: 'a' }, { id: 'l5', type: 'reads', from: 'x', to: 'a' }, { id: 'l6', type: 'reads', from: 'y', to: 'a' }, { id: 'l7', type: 'depends_on', from: 'z', to: 'y' },
    ],
    islands: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }],
  };
  const model = modelOf(answer, { measure, sizes });
  const told: string[] = [];
  const pic = rowsOf(model, Z, (name: string) => told.push(name));
  assert.equal(pic.islands.length, 2);
  const boxes = [...pic.places.values()] as any[];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [p, q] = [boxes[i], boxes[j]];
    assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, 'two boxes overlap');
  }
  for (const w of pic.wires) for (let k = 1; k < w.points.length; k++) assert.ok(w.points[k][0] === w.points[k - 1][0] || w.points[k][1] === w.points[k - 1][1], `${w.id} bends off a right angle`);
  assert.equal(pic.wires.filter((w: any) => w.kind === 'sea').length, 2);
  for (const step of ['blocks', 'rows', 'plans', 'shapes', 'straighten 1', 'streets', 'wires', 'sea: streets']) assert.ok(told.some((n) => n.endsWith(step)), `no stage ${step}`);
  // Only the order sets rows: a is above b, b above c.
  const [a, b, c] = ['a', 'b', 'c'].map((id) => pic.places.get(id).y);
  assert.ok(a < b && b < c);
});
