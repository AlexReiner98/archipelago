// An island's key is wide and low, never one column down its side (round 6 follow-up): no column is longer than
// flow_island_legend_rows, a group may take several, and the header is one piece with its island (it scales with it).

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
// A layout's modules stand together as its pack declares them: copied as they are, then imported.
const laid = mkdtempSync(join(tmpdir(), 'pelago-key-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { columned } = await import(pathToFileURL(join(laid, 'archipelago.js')).href);
const house = pack.styles.find((s: any) => s.id === 'core.house').props;

test('a long key goes on in the next column past the most rows', () => {
  const rows = Array.from({ length: 12 }, () => 80);
  const one = columned(rows, 1, 14, 18);
  assert.equal(one.h, 12 * 18, 'one column without a limit');
  const capped = columned(rows, 1, 14, 18, 4);
  assert.equal(capped.h, 4 * 18, 'four rows tall');
  assert.equal(capped.w, 3 * 80 + 2 * 14, 'three columns wide');
  assert.deepEqual(capped.at[4], [80 + 14, 0], 'the fifth row starts the next column');
});

test('a group stands in its own columns, each at most that many rows', () => {
  const types = Array.from({ length: 7 }, () => ({ w: 70, group: 'type' })), statuses = Array.from({ length: 5 }, () => ({ w: 90, group: 'phase' }));
  const key = columned([...types, ...statuses], 2, 14, 18, 4);
  assert.equal(key.h, 4 * 18);
  const xs = new Set(key.at.map(([x]: number[]) => x));
  assert.equal(xs.size, 4, 'seven types in two columns, five statuses in two');
  assert.ok(key.at[7][0] > key.at[6][0], 'statuses never stand under the types');
  assert.ok(key.at.slice(7).every(([x]: number[]) => x >= key.at[6][0] + 70 + 14 - 1e-6) || key.at[7][0] > key.at[6][0]);
});

test('no limit keeps the old columns, and the house limits the key and keeps the header with its island', () => {
  assert.deepEqual(columned(Array.from({ length: 6 }, () => 50), 2, 10, 18).at.map(([x]: number[]) => x), [0, 0, 0, 60, 60, 60]);
  assert.ok(house.sizes.flow_island_legend_rows > 0 && house.sizes.flow_island_legend_rows <= 4, 'the key is at most a few rows tall');
  assert.equal(house.numbers.flow_island_head_most, 1, 'the header never grows against its island: it scales with the picture');
  assert.equal(house.numbers.flow_island_head_least, 1);
});
