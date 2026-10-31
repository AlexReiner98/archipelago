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
import { layout } from './draw/flow/layout.js';

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

const bars = layout;
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
  assert.equal(faults(g).overlaps, 0, 'what shares a line shares a box: one arrival');
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
  const g = bars({ items: ids.map((id) => item(id)), links, measure, sizes: { ...house.sizes, plane_embed_most: 100 } });
  assert.deepEqual(upward(g), []);
  assert.ok(right(g));
  assert.ok(clear(g));
});

test('bars: the picture does not change with the order the answer came in', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], links = [dep('b', 'a'), dep('c', 'a'), dep('d', 'b'), dep('d', 'c'), dep('b', 'e'), dep('f', 'c'), dep('g', 'e'), dep('f', 'h'), tie('e', 'f', 'serves'), tie('a', 'h', 'serves'), tie('g', 'd', 'serves'), tie('a', 'g', 'calls')];
  const at = (g: any) => ids.map((id) => [g.x.get(id), g.y.get(id)]);
  assert.deepEqual(at(drawnBars([...ids].reverse().map((id) => item(id)), [...links].reverse())), at(drawnBars(ids.map((id) => item(id)), links)));
});

test('bars: a step put by hand stays there, nothing else moves, and its wires stay at right angles clear of the boxes', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item(id)), links = [dep('b', 'a'), dep('c', 'b'), dep('d', 'c'), dep('e', 'a'), dep('d', 'e'), tie('f', 'c', 'calls'), tie('f', 'a', 'calls')];
  const free = bars({ items: ids, links, measure, sizes: house.sizes }), to = [free.x.get('c') + 900, free.y.get('c') + 300];
  const g = bars({ items: ids, links, placed: { c: to }, measure, sizes: house.sizes });
  assert.deepEqual([g.x.get('c'), g.y.get('c')], to);
  for (const id of ['a', 'b', 'd', 'e', 'f']) assert.deepEqual([g.x.get(id), g.y.get(id)], [free.x.get(id), free.y.get(id)], `${id} stays`);
  assert.ok(right(g));
  const through = lines(g).some((w: number[][]) => g.all.some((n: any) => w.slice(1).some((p, i) => {
    const q = w[i], [l, r, t, u] = [g.x.get(n.id) - n.w / 2 + 1, g.x.get(n.id) + n.w / 2 - 1, g.y.get(n.id) - n.h / 2 + 1, g.y.get(n.id) + n.h / 2 - 1];
    return Math.max(p[0], q[0]) > l && Math.min(p[0], q[0]) < r && Math.max(p[1], q[1]) > t && Math.min(p[1], q[1]) < u;
  })));
  assert.equal(through, false, 'no wire runs through a box');
});

test('bars: a holder put by hand takes what hangs on it along', () => {
  const ring = ['p', 'q', 'o'].map((id) => item(id)), kids = [item('k0'), item('k1'), item('k2')], links = [tie('p', 'q', 'serves'), tie('q', 'o', 'serves'), tie('o', 'p', 'serves'), ...kids.map((k) => tie(k.id, 'p'))];
  const free = bars({ items: [...ring, ...kids], links, measure, sizes: house.sizes }), [dx, dy] = [400, 250];
  const g = bars({ items: [...ring, ...kids], links, placed: { p: [free.x.get('p') + dx, free.y.get('p') + dy] }, measure, sizes: house.sizes });
  for (const k of kids) assert.deepEqual([g.x.get(k.id), g.y.get(k.id)], [free.x.get(k.id) + dx, free.y.get(k.id) + dy]);
  assert.ok(right(g));
});

// @ts-expect-error a drawing's modules are plain JavaScript
import { shownOnly } from './draw/flow/graph.js';

const storyCss = readFileSync(join(import.meta.dirname, 'draw/flow/story.js'), 'utf8');

test('story: only what the steps show is laid out, and a wire and its head are lit alike', () => {
  const answer = { items: [item('hub'), item('a'), item('b')], links: [], lens: { from: 'hub' }, steps: [{ add: ['a'] }, { add: ['b'] }] };
  assert.deepEqual(shownOnly(answer).items.map((i: any) => i.id), ['a', 'b']);
  assert.equal(shownOnly({ items: [item('a')] }).items.length, 1);
  for (const rule of ['.lf-tie.sp-new', '.lf-tie.sp-lit', '.lf-tie[class*=lf-k-].sp-new', '.lf-wire[class*=lf-k-].sp-lit', '.lf-head[class*=lf-k-].sp-new']) assert.ok(storyCss.includes(rule), rule);
});

test('bars: every headed link runs down, the order first, and a head never needs to point up', () => {
  const ids = ['hosted', 'file', 'server', 'hub', 'kid'].map((id) => item(id));
  const g = drawnBars(ids, [tie('hosted', 'file', 'calls'), tie('file', 'server', 'calls'), tie('server', 'hosted', 'link'), tie('kid', 'hub'), tie('hub', 'hosted', 'calls'), tie('kid', 'server', 'calls')]);
  assert.ok(g.y.get('hosted') < g.y.get('file') && g.y.get('file') < g.y.get('server'), 'along the heads, and the link that would close the ring gives way');
  assert.ok(g.y.get('hub') < g.y.get('kid'), 'what holds above what is held');
  const order = drawnBars(['a', 'b'].map((id) => item(id)), [dep('b', 'a'), tie('b', 'a', 'calls')]);
  assert.ok(order.y.get('a') < order.y.get('b'), 'where they disagree the order wins');
});

test('bars: a chain stands on one line through the middle of every box', () => {
  const wide = (id: string, title: string) => ({ ...item(id), title });
  const g = drawnBars([wide('a', 'a name of some length here'), wide('b', 'short'), wide('c', 'a long name of quite some length indeed')], [tie('a', 'b', 'calls'), tie('b', 'c', 'calls')]);
  assert.equal(g.x.get('a'), g.x.get('b'));
  assert.equal(g.x.get('b'), g.x.get('c'));
  assert.ok(g.y.get('a') < g.y.get('b') && g.y.get('b') < g.y.get('c'));
});

test('bars: ports keep off the corners, and wires landing on one side keep apart', () => {
  const ids = Array.from({ length: 6 }, (_, k) => `n${k}`);
  const g = drawnBars([item('top'), ...ids.map((id) => item(id))], ids.flatMap((id, k) => [tie(id, 'top', 'calls'), ...(k ? [tie(id, ids[k - 1], 'serves')] : [])]));
  const f = faults(g, { corner: house.sizes.plane_port_corner, parallel: house.sizes.plane_wire_gap });
  assert.ok(f.cornerPorts <= 2, `${f.cornerPorts} on a corner`);
  assert.ok(f.tightParallel <= 2, `${f.tightParallel} too near`);
});

test('bars: a small picture stands in even rows, a fan centred and on one bus, a skipped row its own column', () => {
  const feeders = ['a', 'bb', 'ccc', 'dddd', 'ee', 'f'], g = drawnBars([item('map'), ...feeders.map((id) => item(id))], feeders.map((id) => tie(id, 'map', 'calls')));
  assert.equal(new Set(feeders.map((id) => g.y.get(id))).size, 1, 'one row');
  const xs = feeders.map((id) => g.x.get(id)).sort((p, q) => p - q), gaps = feeders.map((id) => id).sort((p, q) => g.x.get(p) - g.x.get(q)).slice(1).map((id, k, l) => g.x.get(id) - g.nodes.get(id).w / 2 - (g.x.get(k ? l[k - 1] : feeders.find((f) => g.x.get(f) === xs[0])!) + g.nodes.get(k ? l[k - 1] : feeders.find((f) => g.x.get(f) === xs[0])!).w / 2));
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 1, `one gap: ${gaps}`);
  assert.ok(Math.abs(g.x.get('map') - (xs[0] + xs.at(-1)!) / 2) < g.nodes.get('a').w, 'the map under the middle');
  assert.equal(new Set(g.ties.map((t: any) => t.points.at(-1).join())).size, 1, 'one arrival');
  const skip = drawnBars(['a', 'b', 'c', 'd', 'e'].map((id) => item(id)), [tie('a', 'b', 'calls'), tie('b', 'c', 'calls'), tie('c', 'd', 'calls'), tie('d', 'e', 'calls'), tie('b', 'e', 'calls')]);
  assert.equal(skip.x.get('c'), skip.x.get('d'), 'a run stands on one line');
  assert.equal(count(lines(skip)).crossings, 0);
  assert.ok(right(skip) && clear(skip));
  const wide = g.y.get('map') - g.y.get('a') - g.nodes.get('a').h / 2 - g.nodes.get('map').h / 2;
  assert.ok(wide >= house.sizes.plane_row_space - 1);
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
  const g = drawnBars([...ring, wide('upper'), wide('lower')], [tie('p', 'q', 'serves'), tie('q', 'o', 'serves'), tie('o', 'p', 'serves'), tie('upper', 'p'), tie('lower', 'upper')]);
  const w = g.ties.find((t: any) => t.a === 'lower'), n = g.nodes.get('lower');
  assert.equal(w.points.length, 2);
  assert.equal(w.points[0][0], w.points[1][0]);
  assert.ok(Math.abs(Math.min(w.points[0][1], w.points[1][1]) - (g.y.get('upper') + g.nodes.get('upper').h / 2)) < 0.01);
  assert.ok(Math.abs(Math.max(w.points[0][1], w.points[1][1]) - (g.y.get('lower') - n.h / 2)) < 0.01);
  const off: any[] = [];
  faults(g, { note: (kind: string, x: any) => kind === 'indirect' && off.push(x) });
  assert.ok(!off.includes(w), 'not one of those that could be straight');
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

test('bars: pulling tight adds no crossing and no collision', () => {
  const ids = Array.from({ length: 16 }, (_, k) => `n${k}`), links: any[] = [];
  for (let k = 0; k < 16; k++) { if (k % 4 < 3) links.push(tie(`n${k}`, `n${k + 1}`, 'serves')); if (k < 12) links.push(tie(`n${k}`, `n${k + 4}`, 'serves')); }
  const g = drawnBars(ids.map((id) => item(id)), links);
  assert.equal(count(lines(g)).crossings, 0);
  assert.ok(clear(g));
  assert.ok(right(g));
});
