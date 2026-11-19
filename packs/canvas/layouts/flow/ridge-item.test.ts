// An item drawn as a Ridges mountain (round 6, screen e_yczjweyh): the same each time, by form, by state.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// @ts-ignore a page module, untyped
import { bandsOf, colourWays, profile, ridgeMarks, seedOf, steps } from './ridge-item.js';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'pack.json'), 'utf8'));
const house = pack.styles.find((s: any) => s.id === 'core.house').props;
const m = (tag: string, attrs: any = {}, ...kids: any[]) => [tag, attrs, ...kids];
const ways = colourWays(house.ridge_palettes.faroe);
const draw = (id: string, phase: string, mode = 'bands', form = house.ridge_forms.rajaAmpat) => ridgeMarks({ id, x0: 0, x1: 100, base: 50, hgt: 40, form, phase, mode, ways, island: false, m, cols: 22, bands: 3 });

test('a profile is the same each time, and differs by item and by form', () => {
  const a = profile(house.ridge_forms.faroe, seedOf('e_aaaaaaaa'), 22);
  assert.deepEqual(a, profile(house.ridge_forms.faroe, seedOf('e_aaaaaaaa'), 22));
  assert.notDeepEqual(a, profile(house.ridge_forms.faroe, seedOf('e_bbbbbbbb'), 22));
  assert.notDeepEqual(a, profile(house.ridge_forms.galapagos, seedOf('e_aaaaaaaa'), 22));
  assert.ok(a.every((h: number) => h >= 0 && h <= 1.3));
});

test('a karst tower has a flat top and a reef is low with a hollow middle', () => {
  const tower = profile(house.ridge_forms.rajaAmpat, 1, 22), reef = profile(house.ridge_forms.maldives, 1, 22);
  assert.ok(tower.filter((h: number) => h >= Math.max(...tower) - 1e-9).length > 3);
  assert.ok(reef[11] < Math.max(...reef));
});

test('bands follow the state, with a snow cap finished and an accent in trouble', () => {
  assert.deepEqual(bandsOf(ways, 'not_started'), ways.pale);
  assert.deepEqual(bandsOf(ways, 'finished'), ways.dark);
  assert.ok(bandsOf(ways, 'trouble').includes(ways.accent));
  assert.ok(draw('e_x', 'finished').marks.some((k: any) => /lf-ridge-cap/.test(k[1].class)));
  assert.ok(!draw('e_x', 'under_way').marks.some((k: any) => /lf-ridge-cap/.test(k[1].class)));
  assert.ok(draw('e_x', 'under_way').rules.every((r: string) => /fill: #[0-9a-f]{6}/.test(r)));
});

test('an accent ridge emerges with progress', () => {
  const back = (phase: string) => draw('e_x', phase, 'emerge').marks.find((k: any) => /lf-ridge-back/.test(k[1].class));
  assert.equal(back('not_started'), undefined);
  assert.ok(back('under_way') && back('finished'));
  assert.notEqual(back('under_way')[1].d, back('finished')[1].d);
});

test('a stair-stepped area closes on its base', () => {
  assert.match(steps([0.2, 0.5], 0, 10, 20, 10), /^M0 20V18H5V15H10V20Z$/);
});

test('the house style holds the data a ridge reads, and the presets use it', () => {
  for (const t of ['task', 'work', 'question', 'aim', 'record', 'occurrence', 'place', 'actor', 'system']) assert.ok(house.ridge_forms[house.type_forms[t]], t);
  for (const k of ['faroe', 'galapagos', 'svalbard']) assert.ok(house.ridge_palettes[k].colours.length >= 9, k);
  for (const id of ['canvas.ridge_items_bands', 'canvas.ridge_items_emerge', 'canvas.ridge_items_hue']) assert.ok(pack.styles.find((s: any) => s.id === id)?.props.ridge_state, id);
  for (const k of ['flow_ridge_height', 'flow_ridge_name_lift', 'flow_ridge_gap', 'flow_ridge_side', 'flow_ridge_top', 'flow_ridge_cols', 'flow_ridge_bands', 'flow_ridge_ink']) assert.ok(k in house.sizes, k);
});
