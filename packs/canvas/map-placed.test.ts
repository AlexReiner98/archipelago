// A view that lists its islands (feature e_u52abqr4): each item stands at the cell an agent set for it, each island at
// the corner the view keeps, with no solve; what no one placed takes the free cells round them.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = pack.styles.find((s: any) => s.id === 'core.house').props;
const laid = mkdtempSync(join(tmpdir(), 'pelago-map-placed-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const load = (name: string) => import(pathToFileURL(join(laid, name)).href);
const [{ layout }, { compose, islandModels }] = await Promise.all([load('layout.js'), load('archipelago.js')]);
const measure = (t: string, px: number) => String(t).length * px * 0.55;

const item = (id: string, island: string, cell?: number[]) => ({ id, type: 'task', title: id, open: true, status: 'todo', island, fields: cell ? { cell } : {} });
const items = [item('e_aaaaaaaa', 'e_islandaa', [0, 0]), item('e_bbbbbbbb', 'e_islandaa', [2, 1]), item('e_cccccccc', 'e_islandaa'), item('e_dddddddd', 'e_islandbb', [0, 0])];
const links = [{ id: 'r_1', type: 'depends_on', from: 'e_bbbbbbbb', to: 'e_aaaaaaaa' }];
const placed = { e_islandaa: [0, 0], e_islandbb: [6, 0] };

function draw(corners: Record<string, number[]> | undefined) {
  const run = (part: any) => layout({ ...part, undrawn: [], headless: house.headless, measure, sizes: house.sizes, aspect: 1.6, shapes: { type: {} }, ...(corners && { placed: corners }) });
  return compose(islandModels({ items, links, run }), { legends: new Map(), names: new Map(), sizes: house.sizes });
}

test('each item stands at its cell, each island at its corner', () => {
  const g = draw(placed);
  const [ax, ay, bx, by] = [g.x.get('e_aaaaaaaa'), g.y.get('e_aaaaaaaa'), g.x.get('e_bbbbbbbb'), g.y.get('e_bbbbbbbb')];
  assert.ok(bx > ax && by > ay, 'a cell two right and one down stands right of and below the first');
  // The unplaced item takes a free cell round the placed ones, within their span: none stands a block's width off.
  const [cx, cy] = [g.x.get('e_cccccccc'), g.y.get('e_cccccccc')];
  assert.ok(cx <= bx && !(cx === ax && cy === ay) && !(cx === bx && cy === by), 'what no one placed takes a free cell among what was');
  assert.ok(g.x.get('e_dddddddd') > bx, 'the second island stands at its corner, to the right');
});

test('a wire runs square between the two boxes, at right angles to each', () => {
  const g = draw(placed);
  const wire = [...g.chains, ...g.ties].find((w: any) => [w.a, w.b].includes('e_aaaaaaaa'));
  assert.ok(wire, 'the link is drawn');
  assert.ok(wire.points.length >= 2 && wire.points.every((p: number[], i: number) => !i || p[0] === wire.points[i - 1][0] || p[1] === wire.points[i - 1][1]), 'no stretch slants');
});

test('the same picture twice is the same', () => {
  const one = draw(placed), two = draw(placed);
  assert.deepEqual([...one.x], [...two.x]);
  assert.deepEqual([...one.y], [...two.y]);
});

test('an island with no corner stands to the right of those that have one', () => {
  const g = draw({ e_islandbb: [0, 0] });
  assert.ok(g.x.get('e_aaaaaaaa') > g.x.get('e_dddddddd'), 'the island with no corner follows the placed one');
});

test('a big island with nothing placed wraps to a block the pane’s shape, not one tall column', () => {
  const many = Array.from({ length: 40 }, (_, k) => item(`e_many${String(k).padStart(4, '0')}`, 'e_islandcc'));
  const run = (part: any) => layout({ ...part, undrawn: [], headless: house.headless, measure, sizes: house.sizes, aspect: 1.6, shapes: { type: {} }, placed: { e_islandcc: [0, 0] } });
  const g = compose(islandModels({ items: many, links: [], run }), { legends: new Map(), names: new Map(), sizes: house.sizes });
  const xs = new Set(many.map((i) => Math.round(g.x.get(i.id)))), ys = new Set(many.map((i) => Math.round(g.y.get(i.id))));
  assert.ok(xs.size > 1 && ys.size < many.length, `in columns and rows: ${xs.size} by ${ys.size}`);
  const span = (v: number[]) => Math.max(...v) - Math.min(...v);
  const wide = span(many.map((i) => g.x.get(i.id))), tall = span(many.map((i) => g.y.get(i.id)));
  assert.ok(wide / tall > 0.8, `shaped to the pane, not a column: ${Math.round(wide)} by ${Math.round(tall)}`);
});

test('a placed item stands at its own cell, not a block’s width off, and the unplaced fill the cells round it (e_x7c54w7k)', () => {
  const free = Array.from({ length: 9 }, (_, k) => item(`e_free${String(k).padStart(4, '0')}`, 'e_islanddd'));
  const lone = [item('e_lonea000', 'e_islanddd', [2, 1]), item('e_loneb000', 'e_islanddd', [1, 2])];
  const run = (part: any) => layout({ ...part, undrawn: [], headless: house.headless, measure, sizes: house.sizes, aspect: 1.6, shapes: { type: {} }, placed: { e_islanddd: [0, 0] } });
  const g = compose(islandModels({ items: [...free, ...lone], links: [], run }), { legends: new Map(), names: new Map(), sizes: house.sizes });
  const xs = [...new Set(free.map((i) => g.x.get(i.id)))].sort((p, q) => p - q), ys = [...new Set(free.map((i) => g.y.get(i.id)))].sort((p, q) => p - q);
  assert.equal(g.x.get('e_lonea000'), xs[2], 'the cell two right stands in the third column');
  assert.equal(g.y.get('e_lonea000'), ys[1], 'and in the second row');
  assert.equal(g.x.get('e_loneb000'), xs[1]);
  assert.equal(g.y.get('e_loneb000'), ys[2]);
  const at = new Set([...free, ...lone].map((i) => `${g.x.get(i.id)},${g.y.get(i.id)}`));
  assert.equal(at.size, free.length + lone.length, 'no two items share a cell');
});

test('a shelf is as wide as the room: an island starting within it stands beside the one before, one past it goes under', async () => {
  const { shelve } = await import('./layouts/map/placed.js');
  const isle = (id: string, w: number, h: number) => ({ isle: { id, rect: [0, 0, w, h], land: [{ l: 0, t: 0, r: w, b: h }] }, items: [] });
  const at = (across: number) => {
    const loose = [isle('site', 758, 640), isle('core', 2024, 1144), isle('build', 1860, 750)];
    shelve(loose, { x: new Map(), y: new Map(), from: [24, 24], gap: 72, aspect: 1.4, across, right: 0, bottom: 0 });
    return loose.map((i) => i.isle.rect.slice(0, 2));
  };
  // 1020 across: Core starts at 854, inside the room, so beside Site; Build would start at 2950, so under them.
  assert.deepEqual(at(1020), [[24, 24], [854, 24], [24, 1240]]);
  // 560 across: Core would start past the room, so under Site.
  assert.deepEqual(at(560), [[24, 24], [24, 736], [24, 1952]]);
});
