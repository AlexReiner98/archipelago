// The canvas draws from the theme (round 6, the palette): a colour field takes a theme name as well as a hex, the house
// declares the roles a drawing is given, and the waymark preset's boards and islands are theme names.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// @ts-ignore a page module, untyped
import { colourKey, cssColour, isColour } from './layouts/flow/colour.js';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const style = (id: string) => pack.styles.find((s: any) => s.id === id);
const house = style('core.house').props, waymark = style('canvas.waymark').props;

test('a colour is a hex or a theme name, drawn as its variable', () => {
  assert.ok(isColour('#2e7d4f') && isColour('land_3') && !isColour('not a colour') && !isColour(3));
  assert.equal(cssColour('#2E7D4F'), '#2E7D4F');
  assert.equal(cssColour('land_3'), 'var(--land-3)');
  assert.equal(colourKey('#2E7D4F'), '2e7d4f');
  assert.equal(colourKey('land_3'), 'n-land-3');
});

test('the house declares the twelve roles it always gave, and the new ones', () => {
  for (const role of ['sea', 'land', 'inner', 'line', 'text', 'muted', 'accent', 'blocked', 'you', 'session', 'done', 'warn']) assert.ok(role in house.roles, role);
  for (const role of ['active', 'wire', ...Array.from({ length: 8 }, (_, k) => `land_${k + 1}`)]) assert.ok(role in house.roles, role);
  assert.equal(house.roles.line, 'edge', 'the old mapping is kept');
});

test('the waymark preset draws boards and islands from the theme, never from a hex', () => {
  assert.deepEqual(Object.keys(waymark.board_fills), ['not_started', 'under_way', 'waiting', 'finished', 'trouble']);
  for (const f of Object.values(waymark.board_fills) as any[]) assert.ok(isColour(f.fill) && !f.fill.startsWith('#') && isColour(f.text) && !f.text.startsWith('#'));
  assert.deepEqual(waymark.island_hues, Array.from({ length: 8 }, (_, k) => `land_${k + 1}`), 'islands cycle the terrain set');
  assert.ok(parseFloat(waymark.sizes.flow_island_tint) >= 30, 'a fill that can be seen, not 14%');
  assert.equal(waymark.link_colours, undefined, 'wires are ink');
});

test('an island names its terrain, else its pack does, else islands cycle the set', async () => {
  // @ts-ignore a page module, untyped
  const { islandHue } = await import('./layouts/flow/islands.js');
  const style = { island_hues: ['land_1', 'land_2', 'land_3'], pack_terrain: { build: 'land_5' } };
  assert.equal(islandHue(style, isColour, 0, { id: 'a', terrain: 'land_7', pack: 'build' }), 'land_7', 'its own terrain first');
  assert.equal(islandHue(style, isColour, 0, { id: 'a', pack: 'build' }), 'land_5', 'then its pack’s');
  assert.equal(islandHue(style, isColour, 4, { id: 'a', pack: 'site' }), 'land_2', 'else the set in turn');
  assert.equal(islandHue(style, isColour, 1), 'land_2', 'with nothing known of the island');
  assert.equal(islandHue({ island_hues: ['#2e7d4f'] }, isColour, 0, { id: 'a' }), '#2e7d4f', 'a hex still works');
});
