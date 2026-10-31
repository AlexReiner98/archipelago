// A step put by hand is a pin: wires by the same logic as every other wire. Places in, wires out.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error a drawing's modules are plain JavaScript
import { layout as bars } from './layouts/flow/layout.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { faults } from './layouts/flow/faults.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { count } from './layouts/flow/count.js';

const house = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const measure = (t: string, px: number) => t.length * px * 0.5;
const item = (id: string, kind = 'work') => ({ id, title: id, kind, open: true });
const tie = (from: string, to: string, type = 'calls') => ({ type, from, to });
const dep = (from: string, to: string) => ({ type: 'depends_on', from, to });

// A picture big enough to take the pull, not the even rows: a knot of order and ties, with a comb on `hub`.
const ids = Array.from({ length: 48 }, (_, k) => `n${k}`), kids = ['k0', 'k1', 'k2'];
const items = [...ids.map((id) => item(id)), ...kids.map((id) => item(id)), item('hub')];
const links = [...ids.flatMap((id, k) => [...(k % 7 ? [dep(id, ids[k - 1])] : []), ...(k > 8 && k % 5 === 0 ? [tie(ids[k - 8], id)] : [])]), ...kids.map((k) => tie(k, 'hub', 'part_of')), dep('hub', 'n3'), dep('n20', 'hub')];
const free = bars({ items, links, measure, sizes: house.sizes });
const drawnWith = (placed: Record<string, number[]>) => bars({ items, links, placed, measure, sizes: house.sizes });
const lines = (g: any) => [...g.chains, ...g.ties].map((w: any) => w.points);
const square = (g: any) => lines(g).every((w: number[][]) => w.every((p, i) => !i || Math.abs(p[0] - w[i - 1][0]) < 0.01 || Math.abs(p[1] - w[i - 1][1]) < 0.01));
const hits = (g: any, ...only: string[]) => [...g.chains, ...g.ties].filter((w: any) => !only.length || only.includes(w.a) || only.includes(w.b)).filter((w: any) => g.all.some((n: any) => n.id !== w.a && n.id !== w.b && w.points.some((p: number[], i: number) => {
  if (!i) return false;
  const q = w.points[i - 1], [l, r, t, u] = [g.x.get(n.id) - n.w / 2 + 1, g.x.get(n.id) + n.w / 2 - 1, g.y.get(n.id) - n.h / 2 + 1, g.y.get(n.id) + n.h / 2 - 1];
  return Math.max(p[0], q[0]) > l && Math.min(p[0], q[0]) < r && Math.max(p[1], q[1]) > t && Math.min(p[1], q[1]) < u;
})));

const clean = (g: any, id: string, to: number[]) => {
  assert.deepEqual([g.x.get(id), g.y.get(id)], to, 'it stays where it was put');
  assert.ok(square(g), 'every wire at right angles');
  assert.equal(hits(g, id).length, 0, 'no wire of it runs through a box');
  assert.equal(faults(g).loose, 0, 'every end on its shape');
  for (const other of ids.filter((o) => o !== id)) assert.deepEqual([g.x.get(other), g.y.get(other)], [free.x.get(other), free.y.get(other)], `${other} stays`);
};

test('hand: a box moved a short way', () => {
  const to = [free.x.get('n10') + 40, free.y.get('n10') + 30];
  clean(drawnWith({ n10: to }), 'n10', to);
});

test('hand: a box moved across another', () => {
  const to = [free.x.get('n30') + 60, free.y.get('n30') - 10];
  clean(drawnWith({ n10: to }), 'n10', to);
});

test('hand: a box moved past a wire, and what it lands on goes round it', () => {
  const w = free.chains.find((c: any) => c.points.length === 2 && Math.abs(c.points[1][1] - c.points[0][1]) > 100), to = [w.points[0][0], (w.points[0][1] + w.points[1][1]) / 2];
  const id = ids.find((o) => o !== w.a && o !== w.b && !links.some((l) => (l.from === o && (l.to === w.a || l.to === w.b)) || (l.to === o && (l.from === w.a || l.from === w.b))))!;
  const g = drawnWith({ [id]: to });
  assert.deepEqual([g.x.get(id), g.y.get(id)], to);
  assert.ok(square(g));
  assert.equal(hits(g).filter((x: any) => x.a === w.a && x.b === w.b).length, 0, 'the wire it stood on went round');
});

test('hand: a box moved up above what it depends on', () => {
  const to = [free.x.get('n9'), free.y.get('n9') - 300];
  clean(drawnWith({ n10: to }), 'n10', to);
});

test('hand: a box moved into a comb', () => {
  const to = [free.x.get('k1'), free.y.get('k1')];
  const g = drawnWith({ n10: to });
  assert.deepEqual([g.x.get('n10'), g.y.get('n10')], to);
  assert.ok(square(g));
  assert.equal(faults(g).loose, 0);
});

test('hand: a comb kid moved out takes a wire of its own, the rest of the comb stays', () => {
  const to = [free.x.get('n30') + 500, free.y.get('n30') + 200];
  const g = drawnWith({ k1: to });
  assert.deepEqual([g.x.get('k1'), g.y.get('k1')], to);
  assert.ok(square(g));
  assert.equal(hits(g, 'k1').length, 0);
  assert.deepEqual([g.x.get('k0'), g.y.get('k0')], [free.x.get('k0'), free.y.get('k0')]);
});

test('hand: the same places give the same picture, and what one drawing does stays out of the next', () => {
  const first = drawnWith({ n10: [100, 100] }), second = drawnWith({ n10: [100, 100] });
  assert.deepEqual(lines(first), lines(second));
  first.x.set('n1', 9999);
  first.chains[0].points[0][0] = 9999;
  const again = drawnWith({});
  assert.notEqual(again.x.get('n1'), 9999);
  assert.notEqual(again.chains[0].points[0][0], 9999);
  assert.deepEqual(lines(again), lines(free));
});

test('pins: a drag frame, the release and a reload are one call', () => {
  const to = [free.x.get('n30') + 300, free.y.get('n30') - 200];
  const frame = free.place({ n10: to }), reload = drawnWith({ n10: to });
  assert.deepEqual(lines(frame), lines(reload));
  assert.deepEqual(lines(free.place({})), lines(free), 'no pins: the picture as it was first drawn');
  for (let k = 1; k <= 8; k++) free.place({ n10: [to[0] - 40 * k, to[1] + 30 * k] });
  assert.deepEqual(lines(free.place({ n10: to })), lines(reload), 'whatever was dragged through on the way');
});

test('pins: the order of the pins and how they came say nothing', () => {
  const a = [free.x.get('n30') + 300, free.y.get('n30') - 200], b = [free.x.get('n12') - 150, free.y.get('n12') + 90];
  assert.deepEqual(lines(free.place({ n10: a, n12: b })), lines(free.place({ n12: b, n10: a })));
});

test('pins: a comb goes with its holder, its wires as they stood', () => {
  const [dx, dy] = [170, 130], g = free.place({ hub: [free.x.get('hub') + dx, free.y.get('hub') + dy] });
  for (const k of kids) assert.deepEqual([g.x.get(k), g.y.get(k)], [free.x.get(k) + dx, free.y.get(k) + dy], `${k} moved with it`);
  const comb = (m: any) => m.ties.filter((t: any) => kids.includes(t.a) || kids.includes(t.b));
  comb(g).forEach((w: any, n: number) => assert.deepEqual(w.points, comb(free)[n].points.map(([p, q]: number[]) => [p + dx, q + dy])));
});

test('pins: every wire stays its own, wherever a step is dropped', () => {
  for (const id of ['n10', 'n30', 'hub', 'n3']) for (const [dx, dy] of [[90, 60], [-140, 120], [300, -220]]) {
    const g = free.place({ [id]: [free.x.get(id) + dx, free.y.get(id) + dy] });
    assert.equal(count(lines(g)).shared, 0, `${id} by ${dx}, ${dy}`);
    assert.ok(square(g), `${id} by ${dx}, ${dy}`);
  }
});

test('pins: a drop across a wire threads the wires of what was dropped', () => {
  // A wall of a wire across the picture, with the step on one side of it and what it depends on the other.
  const wall = ['w0', 'w1'], row = ['a', 'b'], made = [...wall, ...row, 'c'].map((id) => item(id));
  const tied = [dep('w1', 'w0'), dep('b', 'a'), dep('c', 'a')];
  const g = bars({ items: [...items, ...made], links: [...links, ...tied], measure, sizes: house.sizes });
  const way = g.chains.find((c: any) => c.a === 'n3' || c.b === 'n3'), [x, y] = [g.x.get('n10'), g.y.get('n10')];
  const moved = g.place({ n10: [x + 400, y + 250] });
  assert.equal(hits(moved, 'n10').length, 0, 'no wire of it runs through a box');
  assert.ok(square(moved) && way);
});
