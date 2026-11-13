// A pack whose own declarations do not hold waits with why, and the map loads without it (bug e_6g34wqdm): on 13 Nov
// 2026 a hosted pack's screen named a page the core had just retired, and the server stopped on every start.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { packsWith } from './map.ts';

/** A map pack with a screen on a piece nobody provides, as `time_views` had one on the retired page `time`. */
const STALE = {
  id: 'stale_views', version: '0.1.0', title: 'Stale views', description: 'A screen on a piece that is gone.', requires: ['core'],
  views: [{ id: 'stale_views.gone', title: 'Gone', form: 'screen', on: ['task'], pieces: [{ piece: 'nowhere' }] }],
} as unknown as PackFile;

/** A pack that needs the stale one, so it waits behind it. */
const LEANS = { id: 'leans', version: '0.1.0', title: 'Leans', description: 'Needs the stale pack.', requires: ['core', 'stale_views'] } as unknown as PackFile;

test('a pack whose screen names a piece nobody provides waits with why, and the map loads without it', () => {
  const reg = new Registry(packsWith(STALE, LEANS));
  const stale = reg.states.get('stale_views');
  assert.equal(stale?.state, 'waiting');
  assert.match(stale?.why ?? '', /nowhere/, 'it says which piece');
  assert.equal(reg.states.get('leans')?.state, 'waiting', 'what leans on it waits too');
  assert.ok(!reg.packs.some((p) => p.id === 'stale_views' || p.id === 'leans'), 'neither is loaded');
  assert.equal(reg.states.get('core')?.state, 'active', 'the rest loads');
  assert.ok(reg.types.has('task'));
});
