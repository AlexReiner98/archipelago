// The cola layout (packs/core/layouts/cola/, task e_x7kwbu3e), step by step and whole, without a database: a small
// model of two islands in, its order, places and wires out. Each step keeps a snapshot for the explainer (`stage`).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-ignore: a pack's drawing code, plain JavaScript
import { colaLayout } from '../packs/core/layouts/cola/cola.js';
// @ts-ignore
import { orderOf } from '../packs/core/layouts/cola/order.js';
// @ts-ignore
import { startOf } from '../packs/core/layouts/cola/start.js';
// @ts-ignore
import { sidesOf, parted } from '../packs/core/layouts/cola/channels.js';
// @ts-ignore: WebCola, vendored
import cola from '../ui/cola.module.min.js';

const house = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs', 'core', 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house');
const sizes = (house.props ?? house).sizes;

type Box = { id: string; x: number; y: number; w: number; h: number };
/** Two islands: a chain a→b→c→d on one with a cycle closed back (d→a, the newest), a fan on the other, ties across. */
function model() {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, n) => ({ id, w: 120 + 10 * (n % 3), h: 34, island: n < 4 ? 'i1' : 'i2', made: n }));
  const dep = (id: string, from: string, to: string) => ({ id, from, to, type: 'depends_on', order: true });
  const tie = (id: string, from: string, to: string) => ({ id, from, to, type: 'about', order: false });
  const links = [dep('l1', 'b', 'a'), dep('l2', 'c', 'b'), dep('l3', 'd', 'c'), dep('l4', 'a', 'd'), dep('l5', 'f', 'e'), dep('l6', 'g', 'e'), dep('l7', 'h', 'e'), tie('t1', 'c', 'f'), tie('t2', 'h', 'b'), tie('t3', 'd', 'g')];
  return { items, links, islands: [{ id: 'i1', title: 'One' }, { id: 'i2', title: 'Two' }] };
}
const overlap = (p: Box, q: Box) => Math.abs(p.x - q.x) < (p.w + q.w) / 2 - 0.5 && Math.abs(p.y - q.y) < (p.h + q.h) / 2 - 0.5;

test('order: what is depended on goes above, and the link that would close a cycle (the newest) is dropped', () => {
  const order = orderOf(model());
  assert.deepEqual(order.dropped.map((l: any) => l.id), ['l4']);
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => order.layer.get(id)), [0, 1, 2, 3]);
  assert.ok(order.kept.some((k: any) => k.above === 'a' && k.below === 'b'));
});

test('start: islands side by side, each row its layer, the same every time', () => {
  const m = model(), order = orderOf(m), z = { gap: 24, rise: 48, sea: 96 };
  const one = startOf(m, order.layer, z), two = startOf(m, order.layer, z);
  assert.deepEqual([...one], [...two]);
  assert.ok(one.get('a').y < one.get('b').y && one.get('b').y < one.get('c').y);
  assert.ok(Math.max(...['a', 'b', 'c', 'd'].map((id) => one.get(id).x)) < Math.min(...['e', 'f', 'g', 'h'].map((id) => one.get(id).x)));
});

test('whole: boxes apart, order kept, islands apart, every wire at right angles and on its boxes, each step kept', () => {
  const m = model(), stages: Record<string, any> = {};
  const got = colaLayout(m, sizes, cola, (name: string, snap: unknown) => (stages[name] = snap));
  assert.deepEqual(Object.keys(stages), ['order', 'start', 'placed', 'routed', 'framed']);
  const boxes = new Map<string, Box>(got.boxes.map((b: Box) => [b.id, b]));
  for (const p of got.boxes) for (const q of got.boxes) if (p !== q) assert.ok(!overlap(p, q), `${p.id} and ${q.id} overlap`);
  for (const [above, below] of [['a', 'b'], ['b', 'c'], ['c', 'd'], ['e', 'f'], ['e', 'g'], ['e', 'h']]) assert.ok(boxes.get(above)!.y < boxes.get(below)!.y, `${above} above ${below}`);
  const [f1, f2] = got.islands;
  assert.ok(f1.r <= f2.l || f2.r <= f1.l || f1.b <= f2.t || f2.b <= f1.t, 'the islands overlap');
  assert.equal(got.wires.length, m.links.length);
  for (const w of got.wires) {
    for (let n = 1; n < w.points.length; n++) {
      const [a, b] = [w.points[n - 1], w.points[n]];
      assert.ok(Math.abs(a[0] - b[0]) < 0.01 || Math.abs(a[1] - b[1]) < 0.01, `${w.link} bends at an angle`);
    }
    const on = (box: Box, [x, y]: number[]) => (Math.abs(Math.abs(x - box.x) - box.w / 2) < 0.6 && Math.abs(y - box.y) <= box.h / 2 + 0.6) || (Math.abs(Math.abs(y - box.y) - box.h / 2) < 0.6 && Math.abs(x - box.x) <= box.w / 2 + 0.6);
    assert.ok(on(boxes.get(w.from)!, w.points[0]) && on(boxes.get(w.to)!, w.points.at(-1)), `${w.link} does not end on its boxes`);
  }
  // An order wire leaves the foot of what is depended on and comes into the head of what depends on it.
  const l1 = got.wires.find((w: any) => w.link === 'l1'), a = boxes.get('a')!, b = boxes.get('b')!;
  assert.ok(Math.abs(l1.points[0][1] - (a.y + a.h / 2)) < 0.6 && Math.abs(l1.points.at(-1)[1] - (b.y - b.h / 2)) < 0.6);
});

test('channels: two wires that share a stretch are parted, those that share a point are not', () => {
  const p = (x: number, y: number) => ({ x, y });
  const A = p(0, 0), B = p(100, 0), C = p(100, 100), D = p(0, 100), E = p(200, 0), F = p(100, -100);
  const shared = parted([[A, B, C], [D, C, B, E]], 8, cola);
  const xs = shared.map((r: any) => r.find((s: any) => Math.abs(s[0].x - s[1].x) < 0.01).map((q: any) => q.x)[0]);
  assert.equal(Math.abs(xs[0] - xs[1]), 8);
  assert.equal(sidesOf([[A, B, C], [F, B, E]], cola)(0, 1), false);
});

test('the same model rests the same in another process: no seed left free', () => {
  const code = `import cola from './ui/cola.module.min.js'; import { colaLayout } from './packs/core/layouts/cola/cola.js';
    const m = ${JSON.stringify(model())}; const sizes = ${JSON.stringify(sizes)};
    process.stdout.write(JSON.stringify(colaLayout(m, sizes, cola)));`;
  const there = execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' });
  assert.equal(there, JSON.stringify(colaLayout(model(), sizes, cola)));
});
