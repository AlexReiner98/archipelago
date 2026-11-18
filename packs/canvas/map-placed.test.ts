// A view that lists its islands (feature e_u52abqr4): each item stands at the cell an agent set for it, each island at
// the corner the view keeps, with no solve; what no one placed stands in a block at its island's left edge.

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
  // The unplaced item takes the island's left column, so the placed ones stand one column to its right.
  assert.ok(g.x.get('e_cccccccc') < ax, 'what no one placed stands left of what was');
  assert.ok(g.x.get('e_dddddddd') > bx, 'the second island stands at its corner, to the right');
});

test('a wire runs straight between the two boxes', () => {
  const g = draw(placed);
  const wire = [...g.chains, ...g.ties].find((w: any) => [w.a, w.b].includes('e_aaaaaaaa'));
  assert.ok(wire, 'the link is drawn');
  assert.equal(wire.points.length, 2);
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

test('a placed item linked to nothing joins the block of the unplaced, at its edge, not a block’s width off (e_x7c54w7k)', () => {
  const free = Array.from({ length: 7 }, (_, k) => item(`e_free${String(k).padStart(4, '0')}`, 'e_islanddd'));
  const lone = [item('e_lonea000', 'e_islanddd', [2, 2]), item('e_loneb000', 'e_islanddd', [2, 1])];
  const tied = [item('e_tieda000', 'e_islanddd', [0, 0]), item('e_tiedb000', 'e_islanddd', [1, 0])];
  const all = [...free, ...lone, ...tied], wires = [{ id: 'r_2', type: 'depends_on', from: 'e_tiedb000', to: 'e_tieda000' }];
  const run = (part: any) => layout({ ...part, undrawn: [], headless: house.headless, measure, sizes: house.sizes, aspect: 1.6, shapes: { type: {} }, placed: { e_islanddd: [0, 0] } });
  const g = compose(islandModels({ items: all, links: wires, run }), { legends: new Map(), names: new Map(), sizes: house.sizes });
  const right = Math.max(...free.map((i) => g.x.get(i.id))), last = Math.max(...free.map((i) => g.y.get(i.id)));
  for (const i of lone) assert.ok(g.x.get(i.id) <= right && g.y.get(i.id) >= last, `${i.id} stands in the block's last rows, within its width`);
  // In its cell's reading order: the one a row up comes first.
  const at = (id: string) => [g.y.get(id), g.x.get(id)];
  assert.ok(at('e_loneb000')[0] < at('e_lonea000')[0] || (at('e_loneb000')[0] === at('e_lonea000')[0] && at('e_loneb000')[1] < at('e_lonea000')[1]), 'the loner placed higher reads first');
  for (const i of tied) assert.ok(g.x.get(i.id) > right, `${i.id}, linked, keeps its cell beside the block`);
});
