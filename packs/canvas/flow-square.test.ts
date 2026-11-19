// Wires run square (round 5 of "The canvas, by eye"): every line leaves and enters a box at right angles, runs in the
// gutters and never through a box, and two that share a gutter are set apart. No database: boxes in, lines out.

import assert from 'node:assert/strict';
import test from 'node:test';
import { apart, squareLines } from './layouts/map/square.js';

const sizes = { flow_square_clear: 8, flow_square_port: 12, flow_square_bend: 40, flow_square_cross: 120, flow_square_share: 3, flow_square_port_used: 150, flow_square_track: 4 };
const stand = (list: [string, number, number][]) => ({
  nodes: new Map(list.map(([id]) => [id, { w: 100, h: 30 }])),
  x: new Map(list.map(([id, cx]) => [id, cx])),
  y: new Map(list.map(([id, , cy]) => [id, cy])),
});
const square = (line: number[][]) => line.every((p, i) => !i || p[0] === line[i - 1][0] || p[1] === line[i - 1][1]);
const through = (line: number[][], x: number, y: number) => line.some((p, i) => i && Math.min(p[0], line[i - 1][0]) < x + 50 && Math.max(p[0], line[i - 1][0]) > x - 50 && Math.min(p[1], line[i - 1][1]) < y + 15 && Math.max(p[1], line[i - 1][1]) > y - 15);

test('a wire between boxes that stand apart in both directions has no slanting stretch', () => {
  const { nodes, x, y } = stand([['a', 0, 0], ['b', 300, 200]]);
  const [line] = squareLines({ wires: [{ a: 'a', b: 'b' }], nodes, x, y, sizes });
  assert.ok(line && square(line), JSON.stringify(line));
});

test('a wire goes round a box that stands between, not through it', () => {
  const { nodes, x, y } = stand([['a', 0, 0], ['mid', 150, 0], ['b', 300, 0]]);
  const [line] = squareLines({ wires: [{ a: 'a', b: 'b' }], nodes, x, y, sizes });
  assert.ok(line && square(line) && !through(line, 150, 0), JSON.stringify(line));
});

test('a wire starts on the outline of its box and ends on the other', () => {
  const { nodes, x, y } = stand([['a', 0, 0], ['b', 0, 200]]);
  const [line] = squareLines({ wires: [{ a: 'a', b: 'b' }], nodes, x, y, sizes });
  assert.ok(line);
  assert.equal(line[0][1], 15);
  assert.equal(line.at(-1)![1], 185);
});

test('wires on one line in a gutter are set apart', () => {
  const lines = apart([[[0, 0], [0, 10], [100, 10], [100, 20], [100, 30]], [[5, 0], [5, 10], [90, 10], [90, 0], [90, -10]]], 4);
  assert.notEqual(lines[0]![1][1], lines[1]![1][1]);
  assert.ok(lines.every((l) => l && square(l)));
});
