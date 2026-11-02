// One solve over boxes and wires: places and lines in, places and lines out, every distance asked for and kept.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error a drawing's modules are plain JavaScript
import { faults, spacing } from './layouts/flow/faults.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { layout } from './layouts/flow/layout.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { settle, solve, solveSections } from './layouts/flow/solve.js';

const sizes = { wire: 12, room: 12, run: 18, corner: 14, apart: 8 };
const picture = (boxes: Record<string, [number, number, number, number]>, wires: [string, string, number[][]][]) => {
  const nodes = new Map(Object.entries(boxes).map(([id, b]) => [id, { w: b[2], h: b[3] }]));
  const x = new Map(Object.entries(boxes).map(([id, b]) => [id, b[0]])), y = new Map(Object.entries(boxes).map(([id, b]) => [id, b[1]]));
  const routes = new Map(wires.map(([a, b, points]) => [a < b ? `${a}|${b}` : `${b}|${a}`, { from: a, to: b, points }]));
  return { nodes, x, y, routes };
};
const lines = (routes: Map<string, any>) => [...routes].map(([k, r]) => ({ ends: k.split('|'), points: r.points }));

test('solve: wires on one line stand a spacing apart', () => {
  const g = picture({ a: [100, 20, 200, 40], b: [100, 300, 200, 40], c: [340, 20, 60, 40], d: [340, 300, 60, 40] }, [['a', 'b', [[100, 40], [100, 280]]], ['c', 'd', [[320, 40], [320, 150], [100, 150], [100, 200], [320, 200], [320, 280]]]]);
  solve({ ...g, ...sizes });
  const s = spacing(lines(g.routes), sizes.wire);
  assert.equal(s.down.overlaps + s.across.overlaps, 0);
  assert.equal(s.down.under + s.across.under, 0);
});

test('solve: a box grows for what lands on it, and no further', () => {
  const g = picture({ a: [100, 20, 40, 40], b: [100, 300, 40, 40], c: [40, 300, 40, 40], d: [160, 300, 40, 40] }, [['a', 'b', [[100, 40], [100, 280]]], ['a', 'c', [[90, 40], [90, 200], [40, 200], [40, 280]]], ['a', 'd', [[110, 40], [110, 200], [160, 200], [160, 280]]]]);
  solve({ ...g, ...sizes });
  assert.equal(g.nodes.get('a')!.w, 2 * sizes.wire + 2 * sizes.corner);
  assert.equal(g.nodes.get('b')!.w, 40);
});

test('solve: boxes keep their order and stay apart', () => {
  const g = picture({ a: [50, 20, 60, 40], b: [60, 20, 60, 40], c: [50, 200, 60, 40] }, [['a', 'c', [[50, 40], [50, 180]]]]);
  solve({ ...g, ...sizes });
  assert.ok(g.x.get('b')! - g.x.get('a')! >= 60 + sizes.apart - 1e-6);
});

test('sections: what is not joined stands a section apart, and what is joined to nothing stands close', () => {
  const g = picture({ a: [50, 20, 60, 40], b: [50, 120, 60, 40], c: [120, 20, 60, 40], d: [120, 120, 60, 40], e: [190, 20, 60, 40], f: [260, 20, 60, 40] }, [['a', 'b', [[50, 40], [50, 100]]], ['c', 'd', [[120, 40], [120, 100]]]]);
  solveSections({ ...g, ...sizes, section: 96, gap: 16, margin: 24, aspect: 100 });
  const edges = (id: string) => [g.x.get(id)! - 30, g.x.get(id)! + 30];
  const [al, ar] = edges('a'), [cl, cr] = edges('c');
  assert.ok(Math.max(al, cl) - Math.min(ar, cr) >= 96 - 1e-6, 'two sections keep the section gap');
  assert.equal(Math.abs(g.x.get('e')! - g.x.get('f')!), 60 + 16, 'loose items stand close');
});

const standing = (boxes: Record<string, [number, number, number, number]>) => Object.entries(boxes).map(([id, b]) => ({ id, at: [b[0], b[1]], size: [b[2], b[3]], named: [b[2], b[3]] }));

test('settle: what is held stays, and two wires are parted', () => {
  const boxes = standing({ a: [100, 20, 200, 40], b: [100, 300, 200, 40] });
  const one = { a: 'a', b: 'b', points: [[100, 40], [100, 280]] }, two = { a: 'a', b: 'b', points: [[100, 40], [100, 280]] };
  settle({ boxes, lines: [one, two], held: new Set(['a', 'b']), rounds: 2, ...sizes });
  assert.equal(Math.abs(one.points[0][0] - two.points[0][0]), sizes.wire);
  assert.deepEqual(boxes[0].at, [100, 20]);
});

test('settle: what stood where a pin lands makes room, the pin stays', () => {
  const boxes = standing({ p: [100, 100, 100, 40], q: [130, 110, 100, 40] }), told = settle({ boxes, lines: [], held: new Set(['p']), rounds: 2, ...sizes });
  assert.deepEqual(boxes[0].at, [100, 100]);
  assert.ok(Math.max(Math.abs(boxes[1].at[0] - 100) - 100, Math.abs(boxes[1].at[1] - 100) - 40) >= sizes.apart - 0.5, 'side by side, a gap apart');
  assert.equal(told.freed, 0);
});

test('settle: with too little room every distance gives way alike, and no two wires share a line', () => {
  const boxes = standing({ l: [20, 100, 40, 200], r: [100, 100, 40, 200], t: [60, -60, 100, 40], f: [60, 260, 100, 40] });
  const wire = (at: number) => ({ a: 't', b: 'f', points: [[at, -40], [at, 240]] }), three = [wire(60), wire(60), wire(60)];
  const told = settle({ boxes, lines: three, held: new Set(['l', 'r', 't', 'f']), rounds: 2, ...sizes });
  assert.ok(told.squeezed > 0);
  assert.equal(new Set(three.map((l) => l.points[0][0])).size, 3);
  assert.ok(three.every((l) => l.points[0][0] > 40 && l.points[0][0] < 80), 'all between the boxes');
});

test('solve: an end stays on its box when box and wire move as one', () => {
  // The box and the stretch after its end move up alike, so the point beside the end comes level with where the end was.
  const g = picture({ a: [100, 60, 80, 40], b: [100, 300, 80, 40], c: [30, 300, 40, 40] }, [['a', 'b', [[100, 80], [100, 110], [40, 110], [40, 150], [100, 150], [100, 280]]], ['a', 'c', [[80, 60], [30, 60], [30, 280]]]]);
  solve({ ...g, ...sizes });
  const [r] = lines(g.routes).filter((l) => l.ends.join() === 'a,b'), foot = g.y.get('a')! + g.nodes.get('a')!.h / 2;
  assert.ok(Math.abs(r.points[0][1] - foot) < 1e-6, 'it leaves the foot of the box');
  assert.ok(r.points.every((p: number[], i: number) => !i || p[0] === r.points[i - 1][0] || p[1] === r.points[i - 1][1]), 'every wire at right angles');
});

test('solve: boxes joined by a straight wire stand the larger gap apart', () => {
  const g = picture({ a: [50, 20, 60, 40], b: [130, 20, 60, 40], c: [50, 200, 60, 40], d: [130, 200, 60, 40] }, [['a', 'b', [[80, 20], [100, 20]]]]);
  solve({ ...g, ...sizes, join: 40 });
  assert.ok(g.x.get('b')! - g.x.get('a')! >= 60 + 40 - 1e-6, 'joined, the larger gap');
  assert.ok(Math.abs(g.x.get('d')! - g.x.get('c')!) <= 60 + sizes.apart + 1e-6 || Math.abs(g.y.get('c')! - g.y.get('a')!) >= 40, 'not joined, the plain one');
});

test('solve: a graph that once went in a ring draws, every wire at right angles and on its boxes', () => {
  const house = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
  const items = Array.from({ length: 37 }, (_, k) => ({ id: `n${k}`, title: `step ${k}`, kind: 'work', open: true }));
  const links = '26>18 19>13 30>2 16>0 31>9 29>28 22>21 30>1 25>14 19>0 28>25 35>3 7>1 25>17 30>18 21>3 35>33 11>6 26>5 35>5 15>2 34>8 8>0 25>19 20>11 33>26 25>4 33>26 31>12 26>11 23>19 9>0 32>12 17>13 9>0 19>3 26>5 12>1 23>3 28>10 27>2 32>3 23>17 19>15 18>15 21>18 12>11 26>21 28>20 8>4'.split(' ').map((l) => { const [from, to] = l.split(/[->]/); return { type: l.includes('>') ? 'depends_on' : 'calls', from: `n${from}`, to: `n${to}` }; });
  const g = layout({ items, links, measure: (t: string, px: number) => t.length * px * 0.55, sizes: house.sizes }), wires = [...g.chains, ...g.ties];
  assert.ok(wires.every((w: any) => w.points.every((p: number[], i: number) => !i || p[0] === w.points[i - 1][0] || p[1] === w.points[i - 1][1])));
  assert.equal(faults(g).loose, 0);
});

test('solve: a stretch out by a hair is along its axis', () => {
  const g = picture({ a: [100, 20, 80, 40], b: [100.2, 200, 80, 40] }, [['a', 'b', [[100, 40], [100.2, 180]]]]);
  solve({ ...g, ...sizes });
  const [r] = lines(g.routes);
  assert.equal(r.points[0][0], r.points.at(-1)[0]);
});
