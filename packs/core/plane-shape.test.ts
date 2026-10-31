// Shape: each wire's way chosen before the solve, tried on small sketches with no database. Input in, lines out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shape } from './draw/flow/shape.js';
import { tidy } from './draw/flow/polyline.js';

const SIZES = { room: 12, run: 18, corner: 14, wire: 12, ports: 5, rounds: 2, cost_cross: 100000, cost_bend: 200, cost_side: 300 };
const box = (x: number, y: number, w = 120, h = 40, pointed = false) => ({ x, y, w, h, pointed });
const boxes = (o: Record<string, ReturnType<typeof box>>) => new Map(Object.entries(o));
const bends = (w: { points: number[][] }) => tidy(w.points).length - 2;

test('boxes that face each other are joined by a straight drop', () => {
  const w = { a: 'p', b: 'q', points: [[100, 20], [100, 100], [160, 100], [160, 180]] };
  shape(boxes({ p: box(100, 0), q: box(140, 200) }), [w], SIZES);
  assert.equal(bends(w), 0);
  assert.equal(w.points[0][0], w.points[1][0]);
});

test('a box beside and below is reached with one bend, by the side that faces it', () => {
  const w = { a: 'p', b: 'q', points: [[100, 20], [100, 60], [300, 60], [300, 180]] };
  shape(boxes({ p: box(100, 0), q: box(400, 200) }), [w], SIZES);
  assert.equal(bends(w), 1);
});

test('a way that passes through a box is not taken', () => {
  const w = { a: 'p', b: 'q', points: [[100, 20], [100, 90], [300, 90], [300, 230], [100, 230], [100, 300]] };
  const fat = boxes({ p: box(100, 0), q: box(100, 320), r: box(100, 160, 300, 40) });
  shape(fat, [w], SIZES);
  const [x, y] = [fat.get('r')!.x, fat.get('r')!.y], line = w.points;
  for (let i = 1; i < line.length; i++) {
    const [lo, hi, top, low] = [Math.min(line[i - 1][0], line[i][0]), Math.max(line[i - 1][0], line[i][0]), Math.min(line[i - 1][1], line[i][1]), Math.max(line[i - 1][1], line[i][1])];
    assert.ok(hi <= x - 150 || lo >= x + 150 || low <= y - 20 || top >= y + 20);
  }
});

test('a wire takes a way that crosses nothing over a shorter one that does', () => {
  const still = { a: 'r', b: 's', kept: true, points: [[300, 0], [300, 400]] };
  const w = { a: 'p', b: 'q', points: [[100, 20], [100, 200], [500, 200], [500, 380]] };
  shape(boxes({ p: box(100, 0), q: box(500, 400), r: box(300, -20), s: box(300, 420) }), [still, w], SIZES);
  assert.deepEqual(still.points, [[300, 0], [300, 400]]);
});

test('a wire does not stop on another: the solve could only cross them', () => {
  const still = { a: 'r', b: 's', kept: true, points: [[200, -200], [200, 600]] };
  const w = { a: 'p', b: 'q', points: [[100, 20], [100, 180]] };
  shape(boxes({ p: box(100, 0), q: box(100, 200), r: box(200, -220), s: box(200, 620) }), [still, w], SIZES);
  assert.equal(bends(w), 0);
});

test('a side too small for its ends sends some to the foot', () => {
  const kids = Object.fromEntries(Array.from({ length: 4 }, (_, k) => [`k${k}`, box(400, 100 + k * 100)]));
  const wires = Object.keys(kids).map((id, k) => ({ a: 'p', b: id, points: [[160, 0], [250, 0], [250, 100 + k * 100], [340, 100 + k * 100]] }));
  shape(boxes({ p: box(100, 0), ...kids }), wires, SIZES);
  assert.ok(wires.some((w) => w.points[0][1] === 20));
});

test('a pointed box is only left from its middle', () => {
  const w = { a: 'p', b: 'q', points: [[100, 30], [100, 100], [300, 100], [300, 180]] };
  shape(boxes({ p: box(100, 0, 120, 60, true), q: box(400, 200) }), [w], SIZES);
  assert.ok(w.points[0][0] === 100 || w.points[0][1] === 0, 'it leaves on an axis of the box');
});

test('what was set by rows is left as it stands', () => {
  const w = { a: 'p', b: 'q', kept: true, points: [[100, 20], [100, 100], [160, 100], [160, 180]] };
  shape(boxes({ p: box(100, 0), q: box(140, 200) }), [w], SIZES);
  assert.equal(bends(w), 2);
});
