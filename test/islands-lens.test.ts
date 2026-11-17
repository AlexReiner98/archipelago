// A canvas that draws a list of islands is said as that list (packs/surface/page/islands-lens.js, task e_wnybzm7a):
// its address `islands=a,b` and its tab named by the islands, not "island Aperture business" and `find=island+…`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a page module, plain JavaScript
import { islandsLens, islandsName, islandsOfLens } from '../packs/surface/page/islands-lens.js';
// @ts-expect-error a page module, plain JavaScript
import { islandsIn } from '../packs/surface/page/islands-list.js';

test('a lens of islands and nothing else is read back as its islands, the way an address names them', () => {
  const list = ['e_xgrowth1', 'e_aperture'];
  assert.deepEqual(islandsOfLens(islandsLens(list)), list);
  assert.deepEqual(islandsIn(`islands=${islandsOfLens(islandsLens(list)).join(',')}`), list, 'what the address says, read again');
  assert.deepEqual(islandsOfLens(islandsLens(['e_aperture', 'frontier'])), ['e_aperture'], 'a live read is not drawn by the lens');
});

test('any other lens keeps its own address', () => {
  const island = (more: object) => ({ ...islandsLens(['e_aperture']), ...more });
  assert.equal(islandsOfLens(null), null);
  assert.equal(islandsOfLens(islandsLens([])), null, 'nothing drawn is not a list');
  assert.equal(islandsOfLens({ filter: { find: ['island e_aperture', 'type task'] }, walk: { over: [], steps: 0 } }), null);
  assert.equal(islandsOfLens(island({ filter: { find: ['island e_aperture'], only: ['status done'] } })), null);
  assert.equal(islandsOfLens(island({ filter: { find: ['island e_aperture'], not: [] } })), null);
  assert.equal(islandsOfLens(island({ walk: { over: ['part_of'], steps: 1 } })), null);
  assert.equal(islandsOfLens(island({ limit: 50 })), null);
  assert.equal(islandsOfLens(island({ view: 'plan' })), null);
});

test("a tab is named by its islands: the first's name, and how many more", () => {
  const names: Record<string, string> = { e_aperture: 'Aperture business', e_xgrowth1: 'X growth', e_lightcor: 'Light core' };
  const titleOf = (id: string) => names[id];
  assert.equal(islandsName(['e_aperture'], titleOf), 'Aperture business');
  assert.equal(islandsName(['e_xgrowth1', 'e_aperture', 'e_lightcor'], titleOf), 'X growth + 2');
  assert.equal(islandsName([], titleOf), '');
});
