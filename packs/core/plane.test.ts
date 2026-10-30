// The plane's layout, run alone: every item placed, every link a line, and its count of what crosses.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error a drawing's modules are plain JavaScript
import { count } from './draw/flow/count.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { faces, isPlanar } from './draw/flow/planar.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { layout } from './draw/flow/plane.js';

const house = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const measure = (t: string, px: number) => t.length * px * 0.5;
const item = (id: string, kind = 'work') => ({ id, title: id, kind, open: true });
const tie = (from: string, to: string, type = 'part_of') => ({ type, from, to });
const run = (items: any[], links: any[]) => layout({ items, links, measure, sizes: house.sizes });

test('count: each place two wires cross, known answers', () => {
  assert.equal(count([[[0, 0], [10, 10]], [[0, 10], [10, 0]]]).crossings, 1);
  assert.equal(count([[[0, 0], [10, 0]], [[0, 2], [10, 2]], [[5, -5], [5, 5]]]).crossings, 2);
  assert.equal(count([[[0, 5], [20, 5]], [[5, 0], [5, 10], [15, 10], [15, 0]]]).crossings, 2);
  assert.equal(count([[[0, 0], [10, 0]], [[5, 0], [5, 5]]]).crossings, 0, 'a wire ending on another does not cross it');
});

test('count: wires through one point are every pair, and seen once', () => {
  const c = count([[[-5, 0], [5, 0]], [[0, -5], [0, 5]], [[-5, -5], [5, 5]], [[-5, 5], [5, -5]]]);
  assert.equal(c.crossings, 6);
  assert.equal(c.seen, 1);
});

test('count: wires along one another are shared, not crossed', () => {
  const c = count([[[0, 0], [10, 0]], [[5, 0], [15, 0]]]);
  assert.equal(c.crossings, 0);
  assert.equal(c.shared, 1);
});

test('planar: the five and the three by three are not, a grid is', () => {
  const K5: string[][] = [];
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) K5.push([`v${i}`, `v${j}`]);
  const K33: string[][] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) K33.push([`a${i}`, `b${j}`]);
  const grid: string[][] = [];
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
    if (x < 4) grid.push([`${x},${y}`, `${x + 1},${y}`]);
    if (y < 4) grid.push([`${x},${y}`, `${x},${y + 1}`]);
  }
  assert.equal(isPlanar(K5), false);
  assert.equal(isPlanar(K33), false);
  assert.equal(isPlanar(grid), true);
  assert.equal(faces(grid).length, 17, 'sixteen squares and the outside');
});

test('layout: nothing is an empty picture', () => {
  assert.equal(run([], []).all.length, 0);
});

test('layout: a tree of many leaves places every one, each link a line, none crossing', () => {
  const leaves = Array.from({ length: 40 }, (_, k) => item(`l${k}`));
  const g = run([item('r'), ...leaves], leaves.map((l) => tie(l.id, 'r')));
  assert.equal(g.all.length, 41);
  assert.equal(g.ties.length, 40);
  assert.ok(g.ties.every((t: any) => t.points.length >= 2));
  assert.equal(count(g.ties.map((t: any) => t.points)).crossings, 0);
});

test('layout: an item with no links is placed', () => {
  const g = run([item('a'), item('b')], []);
  assert.equal(g.all.length, 2);
  assert.ok(g.width > 0 && g.height > 0);
});

test('layout: items of the same two share a block with no wire of it crossing', () => {
  const twins = Array.from({ length: 6 }, (_, k) => item(`t${k}`));
  const g = run([item('a'), item('b'), ...twins], twins.flatMap((t) => [tie(t.id, 'a'), tie(t.id, 'b', 'serves')]));
  assert.equal(g.all.length, 8);
  assert.equal(count(g.ties.map((t: any) => t.points)).crossings, 0);
});

test('layout: the order is a wire, and a step put by hand stays there', () => {
  const g = layout({ items: [item('a'), item('b')], links: [{ type: 'depends_on', from: 'b', to: 'a' }], placed: { a: [500, 400] }, measure, sizes: house.sizes });
  assert.equal(g.chains.length, 1);
  assert.equal(g.x.get('a'), 500);
  assert.equal(g.y.get('a'), 400);
});

// @ts-expect-error a drawing's modules are plain JavaScript
import { layout as bars } from './draw/flow/bars.js';

const drawnBars = (items: any[], links: any[]) => bars({ items, links, measure, sizes: house.sizes });
const lines = (g: any) => [...g.chains, ...g.ties].map((w: any) => w.points);
const right = (g: any) => lines(g).every((w: any) => w.every((p: number[], i: number) => !i || p[0] === w[i - 1][0] || p[1] === w[i - 1][1]));
const clear = (g: any) => { const b = g.all; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (Math.abs(g.x.get(b[i].id) - g.x.get(b[j].id)) < (b[i].w + b[j].w) / 2 && Math.abs(g.y.get(b[i].id) - g.y.get(b[j].id)) < (b[i].h + b[j].h) / 2) return false; return true; };

test('bars: a planar graph has no crossing, every wire at right angles, no box on another', () => {
  const ids = Array.from({ length: 16 }, (_, k) => `n${k}`), links: any[] = [];
  for (let k = 0; k < 16; k++) { if (k % 4 < 3) links.push(tie(`n${k}`, `n${k + 1}`, 'serves')); if (k < 12) links.push(tie(`n${k}`, `n${k + 4}`, 'serves')); }
  const g = drawnBars(ids.map((id) => item(id)), links);
  assert.equal(g.all.length, 16);
  assert.equal(count(lines(g)).crossings, 0);
  assert.equal(count(lines(g)).shared, 0, 'no wire runs along another');
  assert.ok(right(g));
  assert.ok(clear(g));
});

test('bars: the five keep to the one crossing threaded', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'], links: any[] = [];
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) links.push(tie(ids[i], ids[j], 'serves'));
  const g = drawnBars(ids.map((id) => item(id)), links);
  assert.ok(right(g));
  assert.ok(clear(g));
  assert.ok(count(lines(g)).crossings <= 2, `${count(lines(g)).crossings} crossings`);
});

test('bars: trees, loose items and a ring all draw', () => {
  const g = drawnBars(['r', 'l1', 'l2', 'x', 'p', 'q', 'o'].map((id) => item(id)), [tie('l1', 'r'), tie('l2', 'r'), tie('p', 'q', 'serves'), tie('q', 'o', 'serves'), tie('o', 'p', 'serves')]);
  assert.equal(g.all.length, 7);
  assert.ok(clear(g));
});

test('bars: many wires into one item each land apart', () => {
  const ids = Array.from({ length: 8 }, (_, k) => `n${k}`);
  const links = ids.flatMap((id) => [tie(id, 'top', 'serves'), tie(id, 'foot', 'serves')]);
  const g = drawnBars([item('top'), item('foot'), ...ids.map((id) => item(id))], links);
  assert.equal(count(lines(g)).crossings, 0);
  assert.equal(count(lines(g)).shared, 0);
  assert.ok(right(g));
});

test('bars: a tree of uneven widths stays off its item and its neighbours', () => {
  const wide = (id: string) => ({ ...item(id), title: 'a much longer title than the others have' });
  const leaves = ['l0', 'l1', 'l2', 'l3', 'l4'].map((id, k) => (k % 2 ? item(id) : wide(id)));
  const ring = ['p', 'q', 'o'].map((id) => item(id));
  const g = drawnBars([...ring, ...leaves], [...leaves.map((l) => tie(l.id, 'p')), tie('p', 'q', 'serves'), tie('q', 'o', 'serves'), tie('o', 'p', 'serves')]);
  assert.equal(g.all.length, 8);
  assert.ok(clear(g));
});

test('bars: in a ring of three only the wire that goes round takes four turns', () => {
  const g = drawnBars(['a', 'b', 'c'].map((id) => item(id)), [tie('a', 'b', 'serves'), tie('b', 'c', 'serves'), tie('c', 'a', 'serves')]);
  const turns = lines(g).map((w: any) => w.length - 2).sort();
  assert.deepEqual(turns, [2, 2, 4]);
});
