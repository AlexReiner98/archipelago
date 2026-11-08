// Step 2 of the one layout (task e_7vp7udzk), with no database: the minimum-cost flow on its own, the sides a box's
// wires ask for, and the shape of small embeddings made by hand (test/shape-cases.ts), each checked as a sketch: an
// integer grid, every stretch level or upright, order wires out of a foot and into a head, turned wires on the right,
// islands as rectangles crossed once at their ports, and no wire through a box or across another but at a crossing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASES } from './shape-cases.ts';
// @ts-expect-error a drawing's modules are plain JavaScript
import { minCostFlow } from '../packs/core/layouts/shape/flow.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { sidesOf } from '../packs/core/layouts/shape/sides.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { shape } from '../packs/core/layouts/shape/index.js';

type P = [number, number];

test('flow: the cheapest way to meet every need', () => {
  // Two give 3 and 2, two take 4 and 1; the cheap arcs fill first.
  const arcs = [{ from: 0, to: 2, cost: 1 }, { from: 0, to: 3, cost: 5 }, { from: 1, to: 2, cost: 2 }, { from: 1, to: 3, cost: 1 }];
  const { flow, cost } = minCostFlow(4, [3, 2, -4, -1], arcs);
  assert.deepEqual(flow, [3, 0, 1, 1]);
  assert.equal(cost, 3 + 2 + 1);
});

test('flow: a least on an arc is carried, and a circulation costs what its leasts cost', () => {
  const { flow, cost } = minCostFlow(3, [0, 0, 0], [{ from: 0, to: 1, low: 2, cost: 1 }, { from: 1, to: 2, cost: 1 }, { from: 2, to: 0, cost: 0 }, { from: 1, to: 0, cost: 5 }]);
  assert.deepEqual(flow, [2, 2, 2, 0]);
  assert.equal(cost, 2 * 2);
});

test('flow: a need nothing can meet is said, not hidden', () => {
  assert.throws(() => minCostFlow(2, [2, -2], [{ from: 0, to: 1, cap: 1 }]), /unmet/);
  assert.throws(() => minCostFlow(2, [1, -2], []), /balance/);
});

test('sides: the order out of the foot, into the head, a turned wire on the right, the rest where they fit', () => {
  // Clockwise round a box: two in from above, three out below, a tie.
  const S = 2, N = 0, E = 1;
  assert.deepEqual(sidesOf([N, N, S, S, S, null]).kept, [true, true, true, true, true, false]);
  // A rotation that cannot give both their sides: the fewest go without.
  const mixed = sidesOf([S, N, S, N]);
  assert.equal(mixed.kept.filter(Boolean).length, 2 + 1);
  assert.deepEqual(sidesOf([E, S]).side, [E, S]);
});

const stretches = (pts: P[]) => pts.slice(1).map((p, i) => [pts[i], p] as [P, P]);
const box = (n: any) => ({ x0: n.x - n.w / 2, y0: n.y - n.h / 2, x1: n.x + n.w / 2, y1: n.y + n.h / 2 });
/** Whether stretch s passes through the inside of rectangle r. */
const through = ([a, b]: [P, P], r: any) => Math.max(a[0], b[0]) > r.x0 && Math.min(a[0], b[0]) < r.x1 && Math.max(a[1], b[1]) > r.y0 && Math.min(a[1], b[1]) < r.y1;
/** Points two stretches share: where they cross or touch. */
function meet([a, b]: [P, P], [c, d]: [P, P]): P[] {
  const lo = (i: number, p: P, q: P) => Math.min(p[i], q[i]), hi = (i: number, p: P, q: P) => Math.max(p[i], q[i]);
  const x0 = Math.max(lo(0, a, b), lo(0, c, d)), x1 = Math.min(hi(0, a, b), hi(0, c, d)), y0 = Math.max(lo(1, a, b), lo(1, c, d)), y1 = Math.min(hi(1, a, b), hi(1, c, d));
  if (x0 > x1 || y0 > y1) return [];
  return x0 === x1 && y0 === y1 ? [[x0, y0]] : [[x0, y0], [x1, y1]];
}

/** Everything a sketch must be, whatever the embedding. */
function checkSketch(name: string, emb: any, s: any) {
  const nodes = new Map(s.nodes.map((n: any) => [n.id, n]));
  const boxes = s.nodes.filter((n: any) => n.kind === 'item');
  for (const w of s.wires) {
    assert.ok(w.points.length >= 2, `${name}: ${w.id} has its ends`);
    for (const [a, b] of stretches(w.points)) {
      assert.ok(Number.isInteger(a[0]) && Number.isInteger(a[1]), `${name}: ${w.id} stands on the grid`);
      assert.ok(a[0] === b[0] || a[1] === b[1], `${name}: ${w.id} runs level or upright`);
      for (const n of boxes) assert.ok(!through([a, b], box(n)), `${name}: ${w.id} runs through ${n.id}`);
    }
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [p, q] = [box(boxes[i]), box(boxes[j])];
    assert.ok(p.x1 <= q.x0 || q.x1 <= p.x0 || p.y1 <= q.y0 || q.y1 <= p.y0, `${name}: ${boxes[i].id} stands on ${boxes[j].id}`);
  }
  // A box is no wider than its busiest side needs, twice over: a wire that would stretch it queues beside it instead.
  for (const n of boxes) {
    const r = box(n), ends = s.wires.filter((w: any) => w.type !== 'unseen').flatMap((w: any) => [w.from === n.id && w.points[0], w.to === n.id && w.points.at(-1)]).filter(Boolean);
    const busiest = Math.max(1, ...[r.y0, r.y1].map((y) => ends.filter((p: P) => p[1] === y).length));
    assert.ok(n.w <= busiest * 2 + 2, `${name}: ${n.id} is ${n.w} wide for ${busiest} wires on a side`);
  }
  // Wires meet only at a crossing or a junction they both pass through.
  const points = new Set(s.nodes.filter((n: any) => n.kind === 'cross' || n.kind === 'junction').map((n: any) => `${n.x},${n.y}`));
  for (let i = 0; i < s.wires.length; i++) for (let j = i + 1; j < s.wires.length; j++) {
    for (const p of stretches(s.wires[i].points)) for (const q of stretches(s.wires[j].points)) {
      for (const m of meet(p, q)) assert.ok(points.has(`${m[0]},${m[1]}`), `${name}: ${s.wires[i].id} meets ${s.wires[j].id} at ${m} with no crossing there`);
    }
  }
  // An order wire leaves the foot of its upper box going down and comes into the head of its lower one; a turned wire
  // leaves and comes in on the right.
  for (const w of emb.wires) {
    const drawn = s.wires.find((d: any) => d.id === w.id), edges = w.edges.map((id: string) => emb.edges.find((e: any) => e.id === id));
    const first = edges[0], last = edges.at(-1), start = drawn.points[0], end = drawn.points.at(-1);
    const from = nodes.get(edges.length > 1 && [edges[1].from, edges[1].to].includes(first.from) ? first.to : first.from) as any;
    const to = nodes.get(edges.length > 1 && [edges.at(-2).from, edges.at(-2).to].includes(last.to) ? last.from : last.to) as any;
    if (first.dir === 'down' && from.kind === 'item') assert.equal(start[1], box(from).y1, `${name}: ${w.id} leaves the foot of ${from.id}`);
    if (last.dir === 'down' && to.kind === 'item') assert.equal(end[1], box(to).y0, `${name}: ${w.id} comes into the head of ${to.id}`);
    if (first.dir === 'up' && from.kind === 'item') assert.equal(start[0], box(from).x1, `${name}: ${w.id} leaves the right of ${from.id}`);
    if (last.dir === 'up' && to.kind === 'item') assert.equal(end[0], box(to).x1, `${name}: ${w.id} comes into the right of ${to.id}`);
  }
  // Islands stand apart, each a rectangle round its items, crossed once by each wire, at a port on its side.
  for (let i = 0; i < s.islands.length; i++) for (let j = i + 1; j < s.islands.length; j++) {
    const [p, q] = [s.islands[i].rect, s.islands[j].rect];
    assert.ok(p[2] < q[0] || q[2] < p[0] || p[3] < q[1] || q[3] < p[1], `${name}: ${s.islands[i].id} overlaps ${s.islands[j].id}`);
  }
  for (const island of s.islands) {
    const [x0, y0, x1, y1] = island.rect;
    for (const n of boxes.filter((b: any) => emb.nodes.find((e: any) => e.id === b.id).island === island.id)) {
      const r = box(n);
      assert.ok(r.x0 > x0 && r.x1 < x1 && r.y0 > y0 && r.y1 < y1, `${name}: ${n.id} stands inside ${island.id}`);
    }
    for (const p of s.ports.filter((q: any) => q.island === island.id)) assert.ok(p.side, `${name}: port ${p.id} stands on a side of ${island.id}`);
    for (const w of s.wires) {
      let crossings = 0;
      for (const [a, b] of stretches(w.points)) {
        const inside = (p: P) => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1, onEdge = (p: P) => !inside(p) && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
        if (inside(a) !== inside(b) || (onEdge(a) !== onEdge(b) && (inside(a) || inside(b)))) crossings++;
      }
      assert.ok(crossings <= 2, `${name}: ${w.id} crosses ${island.id} at most in and out`);
    }
  }
}

const BENDS: Record<string, number> = { chain: 0, cycle: 2, trunk: 2, crossed: 2, islands: 0, hub: 0 };

for (const [name, emb] of Object.entries(CASES)) {
  test(`shape: ${name} is a sketch at right angles with the fewest bends`, () => {
    const s = shape(emb);
    checkSketch(name, emb, s);
    assert.equal(s.bends, BENDS[name], `${name}: bends`);
    assert.equal(s.against, false, `${name}: no rule broken`);
  });
}

test('shape: a trunk is a T, its branches level across its upright stem', () => {
  const s = shape(CASES.trunk), wire = (id: string) => s.wires.find((w: any) => w.id === id).points as P[];
  const [a, b] = stretches(wire('ws'))[0];
  assert.equal(a[0], b[0], 'the stem is upright');
  for (const id of ['wb1', 'wb2']) assert.equal(stretches(wire(id))[0][0][1], stretches(wire(id))[0][1][1], `${id} leaves the junction level`);
});

test('shape: what hangs from one box stands in one row, what it hangs from in another', () => {
  const s = shape(CASES.hub), y = (id: string) => s.nodes.find((n: any) => n.id === id).y;
  assert.equal(new Set(['A', 'B', 'C'].map(y)).size, 1);
  assert.equal(new Set(['X', 'Y'].map(y)).size, 1);
  assert.ok(y('X') < y('H') && y('H') < y('A'));
});

test('shape: a ring broken at one wire runs that wire up on the right', () => {
  const s = shape(CASES.cycle), up = s.wires.find((w: any) => w.id === 'w3').points as P[], a = s.nodes.find((n: any) => n.id === 'A');
  assert.ok(up.every((p) => p[0] >= a.x + a.w / 2), 'it never comes left of the boxes it joins');
  assert.ok(up.at(-1)![1] < up[0][1], 'it ends above where it starts');
});

test('shape: each wire names the nodes it runs from and to, its points in that order', () => {
  const s = shape(CASES.crossed), wb = s.wires.find((w: any) => w.id === 'wb'), box = (id: string) => s.nodes.find((n: any) => n.id === id);
  assert.deepEqual([wb.from, wb.to], ['B', 'C']);
  assert.equal(wb.points[0][1], box('B').y + box('B').h / 2, 'it starts on the foot of B');
  assert.equal(wb.points.at(-1)[1], box('C').y - box('C').h / 2, 'it ends on the head of C');
});

test('shape: two islands, one wire crossing each border straight at its port', () => {
  const s = shape(CASES.islands);
  assert.deepEqual(s.ports.map((p: any) => [p.id, p.side]), [['P1', 'bottom'], ['P2', 'top']]);
  assert.equal(s.wires[0].points.length, 2, 'one straight stretch from A down to B');
  const [i1, i2] = s.islands.map((i: any) => i.rect);
  assert.ok(i1[3] < i2[1], 'the upper island stands above the lower');
});
