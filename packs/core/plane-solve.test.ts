// One solve over boxes and wires: places and lines in, places and lines out, every distance asked for and kept.

import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error a drawing's modules are plain JavaScript
import { spacing } from './draw/flow/faults.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { settle, solve, solveSections } from './draw/flow/solve.js';

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

test('settle: what is free is parted from what stands, and nothing else moves', () => {
  const boxes = standing({ a: [100, 20, 200, 40], b: [100, 300, 200, 40] });
  const fixed = { a: 'a', b: 'b', points: [[100, 40], [100, 280]], free: null }, moved = { a: 'a', b: 'b', points: [[100, 40], [100, 280]], free: new Set(['a', 'b']) };
  settle({ boxes, lines: [fixed, moved], ...sizes });
  assert.deepEqual(fixed.points, [[100, 40], [100, 280]]);
  assert.equal(Math.abs(moved.points[0][0] - 100), sizes.wire);
  assert.deepEqual(boxes[0].at, [100, 20]);
});

test('settle: a stretch landing on what did not move stays on its port', () => {
  const boxes = standing({ a: [100, 20, 200, 40], b: [100, 300, 200, 40] });
  const fixed = { a: 'a', b: 'b', points: [[60, 40], [60, 280]], free: null }, moved = { a: 'a', b: 'b', points: [[60, 40], [60, 160], [140, 160], [140, 280]], free: new Set(['a']) };
  settle({ boxes, lines: [fixed, moved], ...sizes });
  assert.equal(moved.points.at(-1)![0], 140, 'its port on b, which did not move');
  assert.equal(moved.points[0][0], 60 + sizes.wire, 'and on a, which did, a wire away');
});

test('settle: with too little room every distance gives way alike, and no two wires share a line', () => {
  const boxes = standing({ l: [20, 100, 40, 200], r: [100, 100, 40, 200], t: [60, -60, 100, 40], f: [60, 260, 100, 40] });
  const wire = (at: number) => ({ a: 't', b: 'f', points: [[at, -40], [at, 240]], free: new Set(['t', 'f']) }), three = [wire(60), wire(60), wire(60)];
  const told = settle({ boxes, lines: three, ...sizes });
  assert.ok(told.squeezed > 0);
  assert.equal(new Set(three.map((l) => l.points[0][0])).size, 3);
  assert.ok(three.every((l) => l.points[0][0] > 40 && l.points[0][0] < 80), 'all between the boxes');
});
