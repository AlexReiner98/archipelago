// Which packs a workspace may have: the server's list (PELAGO_ONLY_PACKS) and, beside it, the packs one workspace
// alone may have (PELAGO_WORKSPACE_PACKS). A pack taken off the list leaves its items dormant and its fact kept, and
// comes back as it was when the list lets it in again, for that workspace and no other.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packsFor, readOnlyPacks, readWorkspacePacks } from '../src/pack-allow.ts';
import { packStates, setPack } from '../src/packstate.ts';
import { Workspaces } from '../src/workspaces.ts';
import { human, packsWith } from './map.ts';

test('the lists are read from the environment, the kernel always on them', () => {
  assert.equal(readOnlyPacks(undefined), undefined);
  assert.equal(readOnlyPacks(' '), undefined, 'empty is every pack');
  assert.deepEqual(readOnlyPacks('themes, plan'), ['themes', 'plan']);
  assert.deepEqual(readWorkspacePacks('islands=canvas, code; site=work;islands=rails'), { islands: ['canvas', 'code', 'rails'], site: ['work'] });
  assert.deepEqual(readWorkspacePacks(''), {});
  assert.throws(() => readWorkspacePacks('canvas,code'), /names no workspace/);
  assert.equal(packsFor(undefined, { islands: ['code'] }, 'islands'), undefined, 'no list: every pack, for every workspace');
  assert.deepEqual(packsFor(['themes'], { islands: ['code'] }, 'islands'), ['core', 'themes', 'code']);
  assert.deepEqual(packsFor(['themes'], { islands: ['code'] }, 'customer'), ['core', 'themes']);
});

const TALLY = {
  id: 'tally', version: '0.1.0', title: 'Tally', description: 'Counts kept by hand.', requires: ['core'],
  types: [{ id: 'tally_entry', title: 'Tally entry', description: 'A count kept on a day.', extends: 'record' }],
};

test('a pack off the list is off in a workspace, its items kept, and back when that workspace alone may have it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-allow-'));
  const base = { rootDir: join(root, 'workspaces'), dataDir: join(root, 'data'), packsDir: packsWith(TALLY) };
  const state = (w: Awaited<ReturnType<Workspaces['get']>>) => w.pelago.registry.states.get('tally');

  // Every pack on the server: the owner adds tally and keeps an entry of it.
  const one = new Workspaces(base);
  const { pelago: l } = await one.get('default');
  await setPack(l, human, { pack: 'tally', on: true });
  const made = await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'e', type: 'tally_entry', title: 'Drafting' }] });
  const entry = (made as { created: Record<string, string> }).created.e;
  await one.closeAll();

  // The server's list takes it out, and no workspace is let have it: off, dormant, still readable, not to be added.
  const two = new Workspaces({ ...base, packs: ['themes'], workspacePacks: { islands: ['tally'] } });
  const w2 = await two.get('default');
  assert.deepEqual(state(w2), { state: 'off', why: 'not enabled on this server' });
  assert.equal((await w2.pelago.get(entry))?.entity.title, 'Drafting', 'its item is still there');
  assert.equal(w2.pelago.registry.states.get('core')?.state, 'active', "the kernel's pack is never off the list");
  await assert.rejects(setPack(w2.pelago, human, { pack: 'tally', on: true }), /not offered to this workspace/);
  const listed = (w: Awaited<ReturnType<Workspaces['get']>>) => packStates(w.pelago).map((p) => p.id);
  assert.ok(!listed(w2).includes('tally'), 'a pack not offered here is not on its Packs screen');
  assert.ok(listed(w2).includes('core'), 'the packs it is offered are');
  await two.closeAll();

  // Let this workspace alone have it: it is on again as the log left it, with no one adding it again.
  const three = new Workspaces({ ...base, packs: ['themes'], workspacePacks: { default: ['tally'] } });
  const w3 = await three.get('default');
  assert.equal(state(w3)?.state, 'active');
  assert.equal(w3.pelago.registry.types.get('tally_entry')?.dormant, undefined, 'its type is live again');
  assert.ok(packStates(w3.pelago).some((p) => p.id === 'tally'), 'and on its Packs screen again');
  await three.closeAll();
});
