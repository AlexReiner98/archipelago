// Step 3 of the one layout (packs/core/layouts/relax/, task e_7et8f4uv), run on hand-made shapes in step 2's format
// (./relax-sketches.ts) with no database: every stretch keeps its way, nothing new crosses, no two boxes come nearer than
// their gap, what is on an island stays on it, a port stays on its side, every distance is kept, and the rounds are told.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cycle, dense, islands, map, trunk, type Shape } from './relax-sketches.ts';
import { setOut } from './wired.ts';

const house = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs/core/pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const sizes = house.sizes;
/** The relaxation's modules, as a layout would list them. */
export const RELAX = { pack: 'core', id: 'relax', modules: { 'relax.js': 'layouts/relax/relax.js', 'atoms.js': 'layouts/relax/atoms.js', 'order.js': 'layouts/relax/order.js', 'solve.js': 'layouts/relax/solve.js', 'stage.js': 'layouts/kit/stage.js' } };
/** A step's drawn size: as wide as the shape gives it, a point nothing. */
const size = (n: any) => (n.w ? [n.w * 30, 34] : [0, 0]);

async function relaxed(shape: Shape) {
  return setOut(RELAX, async (url) => {
    const { relax } = await import(url('relax.js')), { stages } = await import(url('stage.js'));
    const rounds: any[] = [];
    stages((name: string, s: any) => name === 'relax' && rounds.push(s));
    try { return { out: relax(shape, { size, sizes }), rounds }; } finally { stages(null); }
  });
}

/** Every stretch of every line, as [x1, y1, x2, y2]. */
const stretches = (lines: number[][][]) => lines.flatMap((l) => l.slice(1).map((p, i) => [...l[i], ...p]));
/** How many times two stretches of different lines cross, at a point inside both. */
function crossings(lines: number[][][]) {
  const s = lines.map((l, k) => stretches([l]).map((t) => [...t, k])).flat();
  let n = 0;
  for (const a of s) for (const b of s) {
    if (a[4] >= b[4]) continue;
    const [v, h] = a[0] === a[2] && b[1] === b[3] ? [a, b] : b[0] === b[2] && a[1] === a[3] ? [b, a] : [null, null];
    if (!v || !h) continue;
    const inside = (x: number, p: number, q: number) => x > Math.min(p, q) + 1e-6 && x < Math.max(p, q) - 1e-6;
    if (inside(v[0], h[0], h[2]) && inside(h[1], v[1], v[3])) n++;
  }
  return n;
}

/** How a stretch runs: 0 level, 1 upright. */
const ways = (l: number[][]) => l.slice(1).map((p, i) => (Math.abs(p[0] - l[i][0]) < 1e-6 ? 1 : 0));

function checked(shape: Shape, out: any) {
  assert.equal(out.told.unkept, 0, 'every distance is kept');
  assert.equal(out.told.refused, 0, 'every end stands on a side of its box');
  const before = new Map(shape.wires.map((w) => [w.id, w.points])), tidy = (l: number[][]) => l.filter((p, k) => !k || p[0] !== l[k - 1][0] || p[1] !== l[k - 1][1]);
  for (const w of out.wires) assert.deepEqual(ways(w.points), ways(tidy(before.get(w.id)!)), `${w.id} keeps each stretch's way`);
  for (const w of out.wires) for (const s of stretches([w.points])) assert.ok(Math.abs(s[0] - s[2]) < 1e-6 || Math.abs(s[1] - s[3]) < 1e-6, `${w.id} turns at right angles`);
  assert.equal(crossings(out.wires.map((w: any) => w.points)), crossings(shape.wires.map((w) => w.points)), 'nothing new crosses');
  const boxes = out.nodes.filter((n: any) => n.w);
  for (const p of boxes) for (const q of boxes) if (p.id < q.id) {
    const gx = Math.abs(p.x - q.x) - (p.w + q.w) / 2, gy = Math.abs(p.y - q.y) - (p.h + q.h) / 2;
    assert.ok(Math.max(gx, gy) >= sizes.flow_node_gap - 1e-3, `${p.id} and ${q.id} keep their gap`);
  }
  for (const i of out.islands) {
    const was = shape.islands.find((s) => s.id === i.id)!.rect;
    for (const n of shape.nodes.filter((n) => n.kind === 'item' && n.x > was[0] && n.x < was[2] && n.y > was[1] && n.y < was[3])) {
      const m = out.nodes.find((o: any) => o.id === n.id);
      assert.ok(m.x - m.w / 2 >= i.rect[0] + sizes.flow_island_pad - 1e-3 && m.x + m.w / 2 <= i.rect[2] - sizes.flow_island_pad + 1e-3, `${n.id} stays on ${i.id}`);
    }
  }
  for (const p of out.ports) {
    const i = out.islands.find((s: any) => s.id === p.island).rect, at = { left: [p.x, i[0]], right: [p.x, i[2]], top: [p.y, i[1]], bottom: [p.y, i[3]] }[p.side as 'left']!;
    assert.ok(Math.abs(at[0] - at[1]) < 1e-6, `${p.id} stands on its island's ${p.side}`);
  }
}

for (const [name, make] of Object.entries({ cycle, trunk, dense, islands, map })) {
  test(`the relaxation keeps the shape of ${name}`, async () => {
    const shape = make(), { out, rounds } = await relaxed(shape);
    checked(shape, out);
    assert.ok(rounds.length > 2, 'its rounds are told, to be watched');
    assert.ok(rounds.every((r) => r.nodes.length === shape.nodes.length), 'each round tells every place');
  });
}

test('the relaxation pulls a stretched shape short', async () => {
  const shape = trunk(), { out } = await relaxed(shape);
  const length = (l: number[][]) => stretches([l]).reduce((s, t) => s + Math.abs(t[2] - t[0]) + Math.abs(t[3] - t[1]), 0);
  const grid = shape.wires.reduce((s, w) => s + length(w.points), 0) * sizes.relax_unit, now = out.wires.reduce((s: number, w: any) => s + length(w.points), 0);
  assert.ok(now < grid, `its wires are shorter than the grid drew them (${Math.round(now)} of ${Math.round(grid)})`);
});

test('a style without the relaxation\'s sizes is told so', async () => {
  await setOut(RELAX, async (url) => {
    const { relax } = await import(url('relax.js'));
    assert.throws(() => relax(cycle(), { size, sizes: { ...sizes, relax_unit: undefined } }), /relax_unit/);
  });
});
