// One ground per island (screen e_fngeh3h4): a painted island's look paints on its island's land, its colour mixed into
// the sea at the island's tint as its frame's land is (packs/canvas/layouts/flow/islands.js, color-mix in srgb), and
// that land is the sea its look is handed. Pure: colours in, a colour out.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

// The map's drawing as the page is sent it: its modules side by side, as pack.json lists them.
const canvas = join(import.meta.dirname, '../packs/canvas');
const pack = JSON.parse(readFileSync(join(canvas, 'pack.json'), 'utf8'));
const laid = mkdtempSync(join(tmpdir(), 'pelago-painted-land-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(canvas, file as string), join(laid, name));
const { landOf } = await import(pathToFileURL(join(laid, 'painted.js')).href);

test("an island's land is its colour mixed into the sea at its tint", () => {
  assert.equal(landOf('#ff0000', 0.25, '#000000'), 'rgb(64, 0, 0)');
  assert.equal(landOf('#336699', 0.14, 'rgb(20, 20, 20)'), 'rgb(24, 31, 39)', 'a sea as rgb() reads the same');
  assert.equal(landOf('#336699', 0, '#141414'), 'rgb(20, 20, 20)', 'no tint, the sea itself');
});

test('an island with no colour, or a tint out of reach, is the sea', () => {
  assert.equal(landOf(null, 0.14, '#141414'), '#141414');
  assert.equal(landOf('#336699', Number.NaN, '#141414'), '#141414');
  assert.equal(landOf('#336699', 2, '#141414'), '#141414');
});
