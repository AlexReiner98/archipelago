// A view that lists its islands (feature e_u52abqr4): each item stands at the cell an agent set for it, each island at
// the corner the view keeps, with no solve; what no one placed stands in a column at its island's left edge.

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
