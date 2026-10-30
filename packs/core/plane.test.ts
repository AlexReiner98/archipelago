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
  assert.ok(count(lines(g)).shared <= 2, 'the press can bring a stretch or two alongside another');
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

test('bars: a ring of three stays tight', () => {
  const g = drawnBars(['a', 'b', 'c'].map((id) => item(id)), [tie('a', 'b', 'serves'), tie('b', 'c', 'serves'), tie('c', 'a', 'serves')]);
  const turns = lines(g).map((w: any) => w.length - 2).sort();
  assert.ok(turns.reduce((a: number, b: number) => a + b, 0) <= 8);
});

const dep = (from: string, to: string) => ({ type: 'depends_on', from, to });
const upward = (g: any) => g.chains.filter((c: any) => g.y.get(c.a) >= g.y.get(c.b)).map((c: any) => c.key);

test('bars: what an item waits on hangs above it, what waits on it below', () => {
  const ring = ['p', 'q', 'o'].map((id) => item(id)), leaves = ['before1', 'before2', 'after1', 'after2'].map((id) => item(id));
  const g = drawnBars([...ring, ...leaves], [tie('p', 'q', 'serves'), tie('q', 'o', 'serves'), tie('o', 'p', 'serves'), dep('p', 'before1'), dep('p', 'before2'), dep('after1', 'p'), dep('after2', 'p')]);
  assert.deepEqual(upward(g), []);
  assert.ok(clear(g));
  assert.ok(right(g));
});

test('bars: a tree keeps the order all the way down it', () => {
  const ids = ['r', 'a', 'b', 'c', 'd', 'x', 'y'];
  const g = drawnBars(ids.map((id) => item(id)), [tie('x', 'r', 'serves'), tie('y', 'x', 'serves'), tie('y', 'r', 'serves'), dep('r', 'a'), dep('a', 'b'), dep('c', 'a'), dep('d', 'r')]);
  assert.deepEqual(upward(g), []);
  assert.ok(clear(g));
});

test('bars: many starts and ends all run down, each lent the side it lacks', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const g = drawnBars(ids.map((id) => item(id)), [dep('b', 'a'), dep('c', 'a'), dep('d', 'b'), dep('d', 'c'), dep('b', 'e'), dep('f', 'c'), dep('g', 'e'), dep('f', 'h'), tie('e', 'f', 'serves'), tie('a', 'h', 'serves'), tie('g', 'd', 'serves')]);
  assert.deepEqual(upward(g), []);
  assert.ok(clear(g));
  assert.ok(right(g));
});

test('bars: a start shut in by ties is reached under one of them', () => {
  const rim = Array.from({ length: 6 }, (_, k) => `r${k}`), links: any[] = rim.map((id, k) => tie(id, rim[(k + 1) % 6], 'serves'));
  for (const k of [0, 2, 4]) links.push(dep(rim[k], 'v'));
  for (const k of [1, 3, 5]) links.push(dep(rim[k], rim[k - 1]));
  const g = drawnBars(['v', ...rim].map((id) => item(id)), links);
  assert.deepEqual(upward(g), []);
  assert.equal(count(lines(g)).crossings, 0);
  assert.ok(right(g));
});

// @ts-expect-error a drawing's modules are plain JavaScript
import { planarize } from './draw/flow/thread.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { numbered } from './draw/flow/numbering.js';

test('join: an invisible edge goes from what lacks a wire out to what lacks a wire in', () => {
  const links = [['p', 'q', true], ['r', 's', true], ['q', 'j', false], ['p', 'j', false], ['r', 'j', false], ['s', 'j', false]];
  const hidden = planarize(links, ['p', 'q', 'j', 'r', 's']).wires.filter((w: any) => !w.visible);
  assert.equal(hidden.length, 1);
  assert.ok(hidden[0].leads);
  assert.ok(['q r', 's p'].includes(hidden[0].path.join(' ')), hidden[0].path.join(' '));
});

test('numbering: every item has a neighbour before it and one after, whatever the order asks', () => {
  const edges: any[] = [], ids: string[] = [];
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) {
    ids.push(`${x},${y}`);
    if (x < 5) edges.push([`${x},${y}`, `${x + 1},${y}`, (x * 7 + y * 3) % 4 === 0]);
    if (y < 5) edges.push([`${x},${y}`, `${x},${y + 1}`, (x * 5 + y) % 3 === 0]);
  }
  edges.push(['0,0', '5,5', false], ['5,0', '0,5', false]);
  const g = planarize(edges, ids), { s, t, number } = numbered(g), near = new Map<string, string[]>();
  for (const k of g.owner.keys()) { const [a, b] = k.split('|'); (near.get(a) ?? near.set(a, []).get(a)!).push(b); (near.get(b) ?? near.set(b, []).get(b)!).push(a); }
  assert.equal(number.get(s), 0);
  assert.equal(number.get(t), number.size - 1);
  for (const [v, n] of number) {
    if (v !== s) assert.ok(near.get(v)!.some((w) => number.get(w) < n), `${v} has one before it`);
    if (v !== t) assert.ok(near.get(v)!.some((w) => number.get(w) > n), `${v} has one after it`);
  }
});

test('bars: where the numbering leaves an order wire up, the embedding made for the order takes over', () => {
  const ids = Array.from({ length: 9 }, (_, k) => `n${k}`), links: any[] = [];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) links.push(dep(`n${6 + b}`, `n${a}`), dep(`n${3 + a}`, `n${a}`), dep(`n${6 + b}`, `n${3 + a}`));
  links.push(tie('n0', 'n8', 'calls'), tie('n7', 'n1', 'calls'), tie('n2', 'n3', 'link'));
  const g = drawnBars(ids.map((id) => item(id)), links);
  assert.deepEqual(upward(g), []);
  assert.ok(right(g));
  assert.ok(clear(g));
});

test('bars: the picture does not change with the order the answer came in', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], links = [dep('b', 'a'), dep('c', 'a'), dep('d', 'b'), dep('d', 'c'), dep('b', 'e'), dep('f', 'c'), dep('g', 'e'), dep('f', 'h'), tie('e', 'f', 'serves'), tie('a', 'h', 'serves'), tie('g', 'd', 'serves'), tie('a', 'g', 'calls')];
  const at = (g: any) => ids.map((id) => [g.x.get(id), g.y.get(id)]);
  assert.deepEqual(at(drawnBars([...ids].reverse().map((id) => item(id)), [...links].reverse())), at(drawnBars(ids.map((id) => item(id)), links)));
});

// @ts-expect-error a drawing's modules are plain JavaScript
import { embed } from './draw/flow/upward.js';

test('upward: every stretch has two faces, every face one top and one foot, and the numbers keep the order', () => {
  const links: any[] = [['a', 'b', true], ['a', 'c', true], ['b', 'd', true], ['c', 'd', true], ['a', 'd', true], ['b', 'c', false], ['e', 'a', false], ['e', 'd', false]];
  const g = embed(links, ['a', 'b', 'c', 'd', 'e']), key = (p: string, q: string) => [p, q].sort().join('|');
  assert.equal(g.number.size - g.owner.size + g.faces.length, 2);
  const seen = new Map<string, number>();
  for (const f of g.faces) {
    let turns = 0;
    f.forEach((v: string, k: number) => {
      const [p, q] = [f[(k + 1) % f.length], f[(k + 2) % f.length]];
      seen.set(key(v, p), (seen.get(key(v, p)) ?? 0) + 1);
      if ((g.number.get(p) > g.number.get(v)) !== (g.number.get(q) > g.number.get(p))) turns++;
    });
    assert.equal(turns, 2);
  }
  assert.ok([...seen.values()].every((n) => n === 2));
  assert.equal(new Set(g.number.values()).size, g.number.size);
  for (const [u, v, order] of links) if (order) assert.ok(g.number.get(u) < g.number.get(v));
});

test('bars: a comb reaches each kid by the side facing its holder', () => {
  const leaves = Array.from({ length: 9 }, (_, k) => item(`l${k}`)), ring = ['p', 'q', 'o'].map((id) => item(id));
  const g = drawnBars([...ring, ...leaves], [...leaves.map((l) => tie(l.id, 'p')), tie('p', 'q', 'serves'), tie('q', 'o', 'serves'), tie('o', 'p', 'serves')]);
  for (const w of g.ties.filter((t: any) => t.a.startsWith('l'))) {
    const n = g.nodes.get(w.a);
    assert.ok(Math.abs(w.points[0][0] - (g.x.get(w.a) - n.w / 2)) < 0.01, `${w.a} is reached on its left`);
  }
  assert.ok(clear(g));
  assert.equal(count(lines(g)).crossings, 0);
});

test('bars: one kid alone sits straight on from its box', () => {
  const g = drawnBars(['p', 'q', 'o', 'k'].map((id) => item(id)), [tie('k', 'p'), tie('p', 'q', 'serves'), tie('q', 'o', 'serves'), tie('o', 'p', 'serves')]);
  const w = g.ties.find((t: any) => t.a === 'k');
  assert.equal(w.points.length, 2);
  assert.equal(w.points[0][1], w.points[1][1]);
  assert.ok(clear(g));
});

// @ts-expect-error a drawing's modules are plain JavaScript
import { faults } from './draw/flow/faults.js';

test('bars: a kid under a kid drops straight into its top', () => {
  const ring = ['p', 'q', 'o'].map((id) => item(id)), wide = (id: string) => ({ ...item(id), title: `${id} with a longer name` });
  const g = drawnBars([...ring, wide('upper'), wide('lower')], [tie('p', 'q', 'serves'), tie('q', 'o', 'serves'), tie('o', 'p', 'serves'), tie('upper', 'p', 'calls'), tie('lower', 'upper', 'calls')]);
  const w = g.ties.find((t: any) => t.a === 'lower'), n = g.nodes.get('lower');
  assert.equal(w.points.length, 2);
  assert.equal(w.points[0][0], w.points[1][0]);
  assert.ok(Math.abs(Math.min(w.points[0][1], w.points[1][1]) - (g.y.get('upper') + g.nodes.get('upper').h / 2)) < 0.01);
  assert.ok(Math.abs(Math.max(w.points[0][1], w.points[1][1]) - (g.y.get('lower') - n.h / 2)) < 0.01);
  assert.equal(faults(g).indirect, 0);
  assert.ok(clear(g));
});

test('faults: a wire with a way straight across is counted, and one that takes it is not', () => {
  const nodes = new Map([['a', { id: 'a', w: 100, h: 40 }], ['b', { id: 'b', w: 100, h: 40 }]]), x = new Map([['a', 100], ['b', 140]]), y = new Map([['a', 50], ['b', 150]]);
  const g = (points: number[][]) => ({ nodes, all: [...nodes.values()], x, y, chains: [{ a: 'a', b: 'b', points }], ties: [] });
  assert.equal(faults(g([[120, 70], [120, 130]])).indirect, 0);
  assert.equal(faults(g([[120, 70], [120, 100], [60, 100], [60, 150], [90, 150]])).indirect, 1);
  assert.equal(faults(g([[120, 70], [120, 100], [60, 100], [60, 150], [90, 150]]), { run: 18 }).tightPort, 0);
  assert.equal(faults(g([[120, 70], [120, 80], [150, 80], [150, 130]]), { run: 18 }).tightPort, 1);
  assert.equal(faults(g([[120, 70], [120, 130]]), { join: 80 }).tightJoin, 1);
});

// @ts-expect-error a drawing's modules are plain JavaScript
import { reroute } from './draw/flow/reroute.js';

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
  const boxes = new Map([['a', box(100, 50)], ['b', box(194, 150)]]);
  const wire = { a: 'a', b: 'b', points: [[120, 70], [120, 80], [130, 80], [130, 150], [144, 150]] };
  reroute(boxes, [wire], [], { ...limits, track: 8, room: 12, run: 18 });
  assert.equal(wire.points.length, 2);
  const far = new Map([['a', box(100, 50)], ['b', box(400, 300)]]);
  const bent = { a: 'a', b: 'b', points: [[100, 70], [100, 74], [400, 74], [400, 280]] };
  reroute(far, [bent], [], { ...limits, track: 8, room: 12, run: 18 });
  assert.ok(bent.points.slice(1).every((p, i) => i === bent.points.length - 2 || Math.abs(p[0] - bent.points[0][0]) + Math.abs(p[1] - bent.points[0][1]) >= 18));
});

test('reroute: a short step in a wire is taken out, and a wire stays on its box', () => {
  const boxes = new Map([['a', box(100, 50)], ['b', box(106, 300)], ['m', box(103, 170, 60, 40)]]);
  const wire = { a: 'a', b: 'b', points: [[60, 70], [60, 170], [66, 170], [66, 280]] };
  reroute(boxes, [wire], [], { ...limits, track: 8, room: 0, run: 0 });
  assert.equal(wire.points.length, 2);
  assert.ok(wire.points[0][0] >= 50 && wire.points[0][0] <= 150);
  assert.ok(wire.points[1][0] >= 56 && wire.points[1][0] <= 156);
});

// @ts-expect-error a drawing's modules are plain JavaScript
import { settle } from './draw/flow/settle.js';

const box = (x: number, y: number, w = 100, h = 40) => ({ at: [x, y], size: [w, h] });
const hits = (boxes: Map<string, any>) => { const b = [...boxes.values()]; let n = 0; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (Math.abs(b[i].at[0] - b[j].at[0]) < (b[i].size[0] + b[j].size[0]) / 2 && Math.abs(b[i].at[1] - b[j].at[1]) < (b[i].size[1] + b[j].size[1]) / 2) n++; return n; };

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

test('bars: pulling tight adds no crossing and no collision', () => {
  const ids = Array.from({ length: 16 }, (_, k) => `n${k}`), links: any[] = [];
  for (let k = 0; k < 16; k++) { if (k % 4 < 3) links.push(tie(`n${k}`, `n${k + 1}`, 'serves')); if (k < 12) links.push(tie(`n${k}`, `n${k + 4}`, 'serves')); }
  const g = drawnBars(ids.map((id) => item(id)), links);
  assert.equal(count(lines(g)).crossings, 0);
  assert.ok(clear(g));
  assert.ok(right(g));
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

// @ts-expect-error a drawing's modules are plain JavaScript
import { layout as ranks } from './draw/flow/ranks.js';

const drawnRanks = (items: any[], links: any[]) => ranks({ items, links, measure, sizes: house.sizes });
const lead = (a: string, b: string) => ({ type: 'depends_on', from: b, to: a });

test('ranks: no wire of the order runs up, whatever the ties ask', () => {
  const ids = Array.from({ length: 12 }, (_, k) => `n${k}`), links: any[] = [];
  for (let k = 0; k + 3 < 12; k++) links.push(lead(`n${k}`, `n${k + 3}`));
  for (let k = 0; k + 7 < 12; k++) links.push(tie(`n${k + 7}`, `n${k}`, 'serves'));
  const g = drawnRanks(ids.map((id) => item(id)), links);
  assert.equal(g.all.length, 12);
  assert.ok(g.chains.every((c: any) => g.y.get(c.a) < g.y.get(c.b)));
  assert.ok(right(g));
  assert.ok(clear(g));
});

test('ranks: a ladder of the order draws with no crossing and no wire along another', () => {
  const links = ['a', 'b', 'c', 'd'].flatMap((k, i, l) => [...(i ? [lead(`${l[i - 1]}0`, `${k}0`), lead(`${l[i - 1]}1`, `${k}1`)] : []), tie(`${k}0`, `${k}1`, 'serves')]);
  const g = drawnRanks([...'abcd'].flatMap((k) => [item(`${k}0`), item(`${k}1`)]), links);
  assert.equal(count(lines(g)).crossings, 0);
  assert.equal(count(lines(g)).shared, 0);
});

test('ranks: a tree of ties hangs off its item, and a step of the order stays in the rows', () => {
  const leaves = Array.from({ length: 6 }, (_, k) => item(`l${k}`));
  const g = drawnRanks([item('r'), item('s'), item('o'), ...leaves], [...leaves.map((l) => tie(l.id, 'r')), lead('r', 's'), lead('s', 'o')]);
  assert.equal(g.all.length, 9);
  assert.ok(clear(g));
  assert.ok(g.chains.every((c: any) => g.y.get(c.a) < g.y.get(c.b)));
  assert.equal(count(lines(g)).crossings, 0);
});

test('ranks: loose items, a ring and many links of one pair all draw', () => {
  const g = drawnRanks(['x', 'p', 'q', 'o'].map((id) => item(id)), [tie('p', 'q', 'serves'), tie('p', 'q', 'calls'), tie('q', 'o', 'serves'), tie('o', 'p', 'serves')]);
  assert.equal(g.all.length, 4);
  assert.ok(g.ties.every((t: any) => t.points.length >= 2));
  assert.ok(clear(g));
});
