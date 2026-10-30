// Plane's wires pulled tight and routed again, alone: boxes and lines in, lines out.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error a drawing's modules are plain JavaScript
import { count } from './draw/flow/count.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { reroute } from './draw/flow/reroute.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { settle } from './draw/flow/settle.js';

const house = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const box = (x: number, y: number, w = 100, h = 40) => ({ at: [x, y], size: [w, h] });
const hits = (boxes: Map<string, any>) => { const b = [...boxes.values()]; let n = 0; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (Math.abs(b[i].at[0] - b[j].at[0]) < (b[i].size[0] + b[j].size[0]) / 2 && Math.abs(b[i].at[1] - b[j].at[1]) < (b[i].size[1] + b[j].size[1]) / 2) n++; return n; };
const limits = { ports: house.sizes.plane_reroute_ports, shorter: house.sizes.plane_reroute_shorter, rounds: house.sizes.plane_reroute_rounds };

test('reroute: a wire that wanders takes the straight way, and one bend where it must', () => {
  const boxes = new Map([['a', box(100, 50)], ['b', box(100, 300)], ['c', box(400, 300)]]);
  const straight = { a: 'a', b: 'b', points: [[100, 70], [100, 90], [300, 90], [300, 200], [100, 200], [100, 280]] };
  const bent = { a: 'a', b: 'c', points: [[60, 30], [60, 10], [420, 10], [420, 280]] };
  reroute(boxes, [straight, bent], [], { ...limits, track: 8, room: 0, run: 0 });
  assert.equal(straight.points.length, 2);
  assert.equal(straight.points[0][0], straight.points[1][0]);
  assert.equal(bent.points.length, 3);
  assert.equal(count([straight.points, bent.points]).crossings, 0);
});

test('reroute: no way through a box or across a wire is taken', () => {
  const boxes = new Map([['a', box(100, 50)], ['m', box(100, 200)], ['b', box(100, 350)]]);
  const round = { a: 'a', b: 'b', points: [[120, 70], [120, 100], [300, 100], [300, 300], [120, 300], [120, 330]] };
  reroute(boxes, [round], [], { ...limits, track: 8, room: 0, run: 0 });
  assert.ok(Math.max(...round.points.map((p) => p[0])) >= 150, 'it stays round the middle box');
  const left = new Map([['a', box(100, 50)], ['b', box(100, 350)]]);
  const fence = { a: 'c', b: 'd', points: [[0, 200], [400, 200]] }, wire = { a: 'a', b: 'b', points: [[120, 70], [120, 100], [500, 100], [500, 300], [120, 300], [120, 330]] };
  reroute(left, [wire], [fence.points], { ...limits, track: 8, room: 0, run: 0 });
  assert.equal(count([wire.points, fence.points]).crossings, 0);
});

test('reroute: two boxes that barely overlap join by one straight stretch, and corners keep clear of ports', () => {
  const boxes = new Map([['a', box(100, 50)], ['b', box(170, 150)]]);
  const wire = { a: 'a', b: 'b', points: [[120, 70], [120, 80], [110, 80], [110, 150], [120, 150]] };
  reroute(boxes, [wire], [], { ...limits, track: 8, room: 12, run: 18 });
  assert.equal(wire.points.length, 2);
  const far = new Map([['a', box(100, 50)], ['b', box(400, 300)]]);
  const bent = { a: 'a', b: 'b', points: [[100, 70], [100, 74], [400, 74], [400, 280]] };
  reroute(far, [bent], [], { ...limits, track: 8, room: 12, run: 18 });
  assert.ok(bent.points.slice(1).every((p, i) => i === bent.points.length - 2 || Math.abs(p[0] - bent.points[0][0]) + Math.abs(p[1] - bent.points[0][1]) >= 18));
});

test('reroute: a new way keeps off the corners of a box and from a wire beside it', () => {
  const boxes = new Map([['a', box(100, 50)], ['b', box(100, 300)]]);
  const wire = { a: 'a', b: 'b', points: [[52, 70], [52, 90], [300, 90], [300, 200], [52, 200], [52, 280]] };
  reroute(boxes, [wire], [], { ...limits, track: 8, room: 0, run: 0, gap: 12, corner: 14 });
  assert.equal(wire.points.length, 2);
  assert.ok(wire.points[0][0] >= 64 && wire.points[0][0] <= 136, `${wire.points[0][0]}`);
});

test('reroute: a short step in a wire is taken out, and a wire stays on its box', () => {
  const boxes = new Map([['a', box(100, 50)], ['b', box(106, 300)], ['m', box(103, 170, 60, 40)]]);
  const wire = { a: 'a', b: 'b', points: [[60, 70], [60, 170], [66, 170], [66, 280]] };
  reroute(boxes, [wire], [], { ...limits, track: 8, room: 0, run: 0 });
  assert.equal(wire.points.length, 2);
  assert.ok(wire.points[0][0] >= 50 && wire.points[0][0] <= 150);
  assert.ok(wire.points[1][0] >= 56 && wire.points[1][0] <= 156);
});

test('settle: a wire that snakes between two boxes pulls straight', () => {
  const boxes = new Map([['a', box(100, 50)], ['b', box(100, 300)]]);
  const wires = [{ a: 'a', b: 'b', points: [[100, 70], [100, 90], [400, 90], [400, 250], [100, 250], [100, 280]] }];
  settle(boxes, wires, { gap: 24, track: 8 });
  assert.equal(wires[0].points.length, 2);
  assert.equal(wires[0].points[0][0], wires[0].points[1][0]);
});

test('settle: a box between two others is not passed through', () => {
  const boxes = new Map([['a', box(100, 50)], ['m', box(100, 200)], ['b', box(100, 350)]]);
  const wires = [{ a: 'a', b: 'b', points: [[60, 70], [60, 100], [300, 100], [300, 300], [60, 300], [60, 330]] }];
  settle(boxes, wires, { gap: 24, track: 8 });
  assert.equal(hits(boxes), 0);
  const across = Math.max(...wires[0].points.map((p) => p[0]));
  assert.ok(across >= 150, `the wire stays round the middle box: ${across}`);
  assert.ok(across < 300, `and pulls in: ${across}`);
});

test('settle: two wires that do not cross stay uncrossed, and one that does stays crossed', () => {
  const boxes = new Map([['a', box(100, 50)], ['b', box(400, 50)], ['c', box(100, 300)], ['d', box(400, 300)]]);
  const apart = [{ a: 'a', b: 'c', points: [[100, 70], [100, 280]] }, { a: 'b', b: 'd', points: [[400, 70], [400, 280]] }];
  settle(boxes, apart, { gap: 24, track: 8 });
  assert.equal(count(apart.map((w) => w.points)).crossings, 0);
  const boxes2 = new Map([['a', box(100, 50)], ['b', box(400, 50)], ['c', box(100, 300)], ['d', box(400, 300)]]);
  const crossed = [{ a: 'a', b: 'd', points: [[100, 70], [100, 170], [400, 170], [400, 280]] }, { a: 'b', b: 'c', points: [[420, 70], [420, 200], [120, 200], [120, 280]] }];
  const before = count(crossed.map((w) => w.points)).crossings;
  settle(boxes2, crossed, { gap: 24, track: 8 });
  assert.equal(before, 1);
  assert.equal(count(crossed.map((w) => w.points)).crossings, before);
});

test('settle: wires along one another keep their sides', () => {
  const boxes = new Map([['a', box(100, 50)], ['b', box(500, 300)], ['c', box(100, 550)], ['d', box(500, 800)]]);
  const wires = [
    { a: 'a', b: 'b', points: [[100, 70], [100, 100], [300, 100], [300, 200], [500, 200], [500, 280]] },
    { a: 'c', b: 'd', points: [[100, 570], [100, 590], [300, 590], [300, 190], [420, 190], [420, 700], [500, 700], [500, 780]] },
  ];
  const done = settle(boxes, wires, { gap: 24, track: 8 });
  assert.equal(done.undone, 0);
  assert.ok(wires.every((w) => w.points.length <= 8));
});

test('settle: a wire of the order keeps its box above the next', () => {
  const boxes = new Map([['a', box(100, 300)], ['b', box(500, 400)]]);
  const wires = [{ a: 'a', b: 'b', down: true, points: [[100, 320], [100, 340], [500, 340], [500, 380]] }];
  settle(boxes, wires, { gap: 24, track: 8 });
  assert.ok(boxes.get('a')!.at[1] < boxes.get('b')!.at[1]);
});

test('settle: the press keeps the room joined boxes and ports were given', () => {
  const boxes = new Map([['a', box(100, 50)], ['b', box(400, 300)]]);
  const wires = [{ a: 'a', b: 'b', down: true, points: [[100, 70], [100, 120], [400, 120], [400, 280]] }];
  settle(boxes, wires, { gap: 8, track: 5, room: 12, join: 28, run: 18 });
  const [a, b] = [boxes.get('a')!, boxes.get('b')!], p = wires[0].points;
  assert.ok(b.at[1] - a.at[1] >= 40 + 28 - 0.01, `${b.at[1] - a.at[1]}`);
  if (p.length > 2) assert.ok(Math.abs(p[1][1] - p[0][1]) >= 18 - 0.01 && Math.abs(p.at(-1)![1] - p.at(-2)![1]) >= 18 - 0.01, JSON.stringify(p));
});

test('settle: boxes stopped against each other slide as a block when that shortens their wires', () => {
  const made = () => ({
    boxes: new Map([['a', box(100, 200)], ['b', box(208, 200)], ['l', box(100, 40)], ['r', box(900, 40)], ['r2', box(900, 400)], ['r3', box(760, 400)]]),
    wires: [
      { a: 'l', b: 'b', points: [[100, 60], [100, 120], [208, 120], [208, 180]] },
      { a: 'r', b: 'b', points: [[900, 60], [900, 130], [220, 130], [220, 180]] },
      { a: 'r2', b: 'a', points: [[900, 380], [900, 280], [120, 280], [120, 220]] },
      { a: 'r3', b: 'a', points: [[760, 380], [760, 300], [100, 300], [100, 220]] },
    ],
  });
  const length = (w: any[]) => w.reduce((sum, v) => sum + v.points.reduce((n: number, p: number[], i: number) => n + (i ? Math.abs(p[0] - v.points[i - 1][0]) + Math.abs(p[1] - v.points[i - 1][1]) : 0), 0), 0);
  const [plain, moved] = [made(), made()];
  settle(plain.boxes, plain.wires, { gap: 8, track: 5 });
  settle(moved.boxes, moved.wires, { gap: 8, track: 5, blocks: 12 });
  assert.ok(length(moved.wires) <= length(plain.wires), `${length(moved.wires)} against ${length(plain.wires)}`);
  assert.equal(hits(moved.boxes), 0);
  assert.equal(count(moved.wires.map((w) => w.points)).crossings, count(plain.wires.map((w) => w.points)).crossings);
});

test('settle: a port slides round a corner when that takes out bends', () => {
  const boxes = new Map([['a', box(100, 200)], ['b', box(500, 200)]]);
  const wires = [{ a: 'a', b: 'b', points: [[100, 220], [100, 300], [500, 300], [500, 220]] }];
  settle(boxes, wires, { gap: 24, track: 8 });
  assert.ok(wires[0].points.length <= 3, JSON.stringify(wires[0].points));
});

test('settle: a port does not slide through a wire or a box', () => {
  const boxes = new Map([['a', box(100, 200)], ['b', box(500, 200)], ['m', box(300, 200)]]);
  const wires = [{ a: 'a', b: 'b', points: [[100, 220], [100, 300], [500, 300], [500, 220]] }];
  settle(boxes, wires, { gap: 24, track: 8 });
  assert.equal(hits(boxes), 0);
  const m = boxes.get('m')!, through = wires[0].points.some((p, i) => i > 0 && p[1] === wires[0].points[i - 1][1] && p[1] > m.at[1] - 20 && p[1] < m.at[1] + 20 && Math.min(p[0], wires[0].points[i - 1][0]) < m.at[0] && Math.max(p[0], wires[0].points[i - 1][0]) > m.at[0]);
  assert.equal(through, false);
});

