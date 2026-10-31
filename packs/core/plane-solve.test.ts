// One solve over boxes and wires: places and lines in, places and lines out, every distance asked for and kept.

import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error a drawing's modules are plain JavaScript
import { spacing } from './draw/flow/faults.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { solve, solveSections } from './draw/flow/solve.js';

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
