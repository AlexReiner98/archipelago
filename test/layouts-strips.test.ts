// The flow layouts' shared kit (packs/core/layouts/kit/) and the strips layout built on it (packs/core/layouts/strips/),
// run as the page loads them, with no database: lanes packed by the left edge, bundles cut to a trunk, the order sorted
// by the links' ways, a band round its steps, ends landed, and strips drawn of small graphs and of islands.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { drawings, setOut } from './wired.ts';

const strips = drawings.find((d) => d.id === 'core.strips')!;
const house = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs/core/pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const measure = (text: string, px: number) => text.length * px * 0.55;
const item = (id: string, more: Record<string, unknown> = {}) => ({ id, type: 'task', title: `Step ${id}`, open: true, created_at: `2026-11-0${id.length}T00:00:${id.padStart(2, '0').slice(-2)}Z`, ...more });
const dep = (from: string, to: string) => ({ type: 'depends_on', from, to });
const args = (items: any[], links: any[]) => ({ items, links, measure, sizes: house.sizes, headless: house.headless, undrawn: house.undrawn ?? [] });
/** The kit's and strips' modules, by name, as the page loads them. */
const withModules = <T>(use: (mod: (name: string) => Promise<any>) => Promise<T>) => setOut(strips, (url) => use((name) => import(url(name))));

/** Every stretch of every line, as [x1, y1, x2, y2]. */
const stretches = (lines: number[][][]) => lines.flatMap((l) => l.slice(1).map((p, i) => [...l[i], ...p]));
/** How many pairs of stretches lie on one line and overlap. */
function shared(lines: number[][][]) {
  const s = stretches(lines);
  let n = 0;
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    const [a, b] = [s[i], s[j]];
    const down = a[0] === a[2] && b[0] === b[2] && a[0] === b[0], across = a[1] === a[3] && b[1] === b[3] && a[1] === b[1];
    const [k, o] = down ? [1, 3] : [0, 2];
    if ((down || across) && Math.min(Math.max(a[k], a[o]), Math.max(b[k], b[o])) - Math.max(Math.min(a[k], a[o]), Math.min(b[k], b[o])) > 0.5) n++;
  }
  return n;
}

test('lanes: the left-edge method takes as few lanes as overlap at once, the shortest nearest', () => withModules(async (mod) => {
  const { lanes } = await mod('lanes.js');
  const { lane, count } = lanes([[0, 9], [1, 2], [3, 4], [2, 5]]);
  assert.equal(count, 3);
  assert.equal(lane[0], count - 1, 'the longest span is furthest out');
  assert.equal(lane[1], lane[2], 'two spans apart share a lane');
  assert.notEqual(lane[1], lane[3], 'spans that touch a row do not');
  assert.deepEqual(lanes([[0, 10], [14, 20]], 4).count, 1, 'apart in pixels');
}));

test('bundle: wires on one trunk are cut where they leave it, and only the trunk carries a head', () => withModules(async (mod) => {
  const { bundle } = await mod('bundle.js');
  const hub = [0, 0], line = (y: number) => [hub, [10, 0], [10, y], [0, y]];
  const out = bundle([{ points: line(30), hub: 'a' }, { points: line(60), hub: 'a' }, { points: line(-20), hub: 'a' }]);
  assert.deepEqual(out[1].points, line(60), 'the longest is whole');
  assert.deepEqual(out[0].points, [[10, 30], [0, 30]]);
  assert.equal(out[0].stop, true);
  assert.deepEqual(out[2].points, [[10, 0], [10, -20], [0, -20]], 'the other way, from the junction');
  assert.equal(shared(out.map((w: any) => w.points)), 0);
  const into = bundle([{ points: [...line(30)].reverse(), hub: 'b' }, { points: [...line(60)].reverse(), hub: 'b' }]);
  assert.equal(into[0].toPort, true, 'a wire cut at its head ends on the trunk');
  assert.deepEqual(into[0].points, [[0, 30], [10, 30]]);
}));

test('model: the order keeps every way, the free choice and a ring by when made, and says what runs up', () => withModules(async (mod) => {
  const { model, sorted } = await mod('model.js');
  assert.deepEqual(sorted(['c', 'b', 'a'], new Map([['b a', 3]]), (id: string) => ({ a: 2, b: 1, c: 0 })[id]), ['c', 'b', 'a']);
  assert.deepEqual(sorted(['a', 'b'], new Map([['a b', 1], ['b a', 1]]), (id: string) => (id === 'a' ? 0 : 1)), ['a', 'b'], 'a ring broken by when made');
  const m = model(args([item('a'), item('bb'), item('ccc')], [dep('bb', 'a'), dep('ccc', 'bb'), { type: 'relates_to', from: 'a', to: 'ccc' }]));
  assert.deepEqual(m.order, ['a', 'bb', 'ccc'], 'what is depended on first');
  const back = { a: 'ccc', b: 'a', type: 'relates_to' };
  assert.equal(m.against(back), true, 'a headed link from below to above runs up');
  assert.equal(m.against(m.chains[0]), false);
}));

test('band: an island\'s frame round its steps, its name and legend over them', () => withModules(async (mod) => {
  const { band } = await mod('bands.js');
  const z = (k: string) => house.sizes[`flow_island_${k}`];
  const b = band({ w: 100, h: 200 }, { name: 80, legend: [60, 70, 50], sizes: house.sizes });
  assert.equal(b.entries.length, 3);
  assert.ok(b.content[1] >= z('pad') + z('name_room') + z('legend_row'), 'the steps stand under the header');
  assert.equal(b.h, b.content[1] + 200 + z('pad'));
  assert.equal(band({ w: 5, h: 5 }, { shore: false, sizes: house.sizes }).land, null, 'what lives on no island has no frame');
}));

test('strips: one step a row, the order down the right gutter, what runs up dashed on the left, no wire on another', () => withModules(async (mod) => {
  const { layout } = await mod('layout.js');
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const g = layout(args(ids.map((id) => item(id)), [dep('b', 'a'), dep('c', 'b'), dep('d', 'a'), dep('e', 'c'), { type: 'blocks', from: 'e', to: 'a' }]));
  assert.equal(new Set(ids.map((id) => g.y.get(id))).size, ids.length, 'a row each');
  for (const c of g.chains) assert.ok(g.y.get(c.a) < g.y.get(c.b), 'what is depended on above');
  assert.deepEqual(['a', 'b', 'c', 'e', 'd'].map((id) => g.y.get(id)), ids.map((id) => g.y.get(id)).sort((p, q) => p - q), 'a chain kept together before the next is begun');
  assert.equal(new Set(ids.map((id) => g.x.get(id) - g.nodes.get(id).w / 2)).size, 1, 'every step at the strip\'s left edge');
  const up = g.ties.find((t: any) => t.type === 'blocks');
  assert.ok(up.dashed, 'a link against the order is dashed');
  assert.ok(Math.min(...up.points.map((p: number[]) => p[0])) < g.x.get('a') - g.nodes.get('a').w / 2, 'on the left');
  for (const c of g.chains) assert.ok(Math.max(...c.points.map((p: number[]) => p[0])) > g.x.get(c.a), 'the order on the right');
  assert.equal(shared([...g.chains, ...g.ties].map((w: any) => w.points)), 0);
}));

test('strips: a hub\'s links are one lane with a stop at each, one head into it', () => withModules(async (mod) => {
  const { layout } = await mod('layout.js');
  const kids = ['k1', 'k2', 'k3', 'k4', 'k5'];
  const g = layout(args([item('hub'), ...kids.map((id) => item(id))], kids.map((id) => dep(id, 'hub'))));
  const xs = new Set(g.chains.flatMap((c: any) => c.points.slice(1, -1).map((p: number[]) => p[0])));
  assert.equal(xs.size, 1, 'one lane');
  assert.equal(g.chains.filter((c: any) => c.stop).length, kids.length - 1, 'every wire but the trunk starts at its stop');
  assert.equal(shared(g.chains.map((c: any) => c.points)), 0);
}));

test('strips on islands: a band each, side by side in the order their links run, a link across a lane at sea', () => withModules(async (mod) => {
  const { islandModels, compose } = await mod('archipelago.js');
  const { layout } = await mod('layout.js');
  const items = [item('a', { island: 'i1' }), item('b', { island: 'i1' }), item('c', { island: 'i2' }), item('dd', { island: 'i2' }), item('e', { island: 'i3' })];
  const links = [dep('b', 'a'), dep('dd', 'c'), { type: 'reads', from: 'c', to: 'b' }, { type: 'reads', from: 'e', to: 'a' }];
  const parts = islandModels({ items, links, run: (part: any) => layout(args(part.items, part.links)) });
  const g = compose(parts, { legends: new Map(), names: new Map([['i1', 40], ['i2', 40], ['i3', 40]]), sizes: house.sizes });
  assert.equal(g.islands.length, 3);
  const left = (id: string) => g.islands.find((i: any) => i.id === id).land[0].l;
  assert.ok(left('i1') < left('i2') && left('i1') < left('i3'), 'a finding\'s island before its readers\'');
  const across = g.ties.filter((t: any) => t.crossing);
  assert.equal(across.length, 2);
  for (const t of across) assert.equal(t.gates.length, 2, 'a gate on each shore');
  const lands = g.islands.map((i: any) => i.land[0]);
  for (const t of across) for (const p of t.sea.slice(1, -1)) assert.ok(!lands.some((r: any) => p[0] > r.l && p[0] < r.r && p[1] > r.t && p[1] < r.b), 'its sea stretch is at sea');
  assert.equal(shared([...g.chains, ...g.ties].map((w: any) => w.points)), 0);
}));
