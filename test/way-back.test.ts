// The way back to shipped parts (packs/loader/kernel/way-back.ts, task e_f7tbyj8u): whatever an island pins and the
// owner keeps, the shipped read gives each part as its pack ships it; refinedOn says what differs, and the way back
// unpins the island.

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { islandRegistry } from '../packs/loader/kernel/island-pin.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { setIslands, setPack } from '../packs/loader/kernel/packstate.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { partsFor } from '../packs/loader/kernel/ui-parts.ts';
import { refinedOn, shippedFolder, shippedParts, wayBackOps } from '../packs/loader/kernel/way-back.ts';
import { freshWith, human, make, packsWith } from './map.ts';

/** The test pack's own parts: the repository's packs ship parts beside them (findings's). */
const shelfs = <T extends { pack: string }>(parts: T[]) => parts.filter((p) => p.pack === 'shelf');

/** A map pack with one part, its look a module of its own. */
const shelf = {
  id: 'shelf', version: '1.0.0', title: 'Shelf', description: 'A part of the page.', requires: ['core'],
  parts: [{ id: 'shelf.row', title: 'Row', slot: 'sheet', marks: ['box', 'text', 'button'], reads: { task: ['title'] }, modules: { 'index.js': 'parts/row/index.js', 'look.js': 'parts/row/look.js' } }],
};

function folder(): string {
  const dir = packsWith(shelf as unknown as PackFile);
  mkdirSync(join(dir, 'shelf', 'parts', 'row'), { recursive: true });
  writeFileSync(join(dir, 'shelf', 'parts', 'row', 'index.js'), "import { look } from './look.js';\nexport default () => ['text', { look }, 'row'];\n");
  writeFileSync(join(dir, 'shelf', 'parts', 'row', 'look.js'), "export const look = 'shipped';\n");
  return dir;
}

test('the shipped read gives git’s code, whatever an island pins or the owner keeps, and the way back unpins', async () => {
  const dir = folder();
  const l = await freshWith(new Registry(dir));
  try {
    const [row] = shelfs(shippedParts(l));
    assert.match(row.modules!['look.js'], /shipped/);
    assert.equal(shelfs(shippedParts(l, [row.hash]))[0].modules, undefined, 'a page that has them is sent the hash alone');

    await setIslands(l, human, true);
    await setPack(l, human, { pack: 'shelf', on: true });
    const { trial, plain } = await make(l, [
      { op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'core' } },
      { op: 'create', ref: 'plain', type: 'island', title: 'Plain', props: { pack: 'core' } },
    ]);
    assert.equal(await refinedOn(l, plain), undefined, 'an island drawing what ships has no way back to show');

    // A version with code of its own over the part, pinned on one island: it draws that code there...
    const { v } = await make(l, [{ op: 'create', ref: 'v', type: 'pack', title: 'Shelf, broken', props: { version_of: 'shelf', manifest: {}, code: { 'parts/row/look.js': "export const look = 'refined';\n" } } }]);
    await make(l, [{ op: 'update', id: trial, props: { pack_version: v } }]);
    const there = await islandRegistry(l, trial);
    assert.match(shelfs(partsFor(there))[0].modules!['look.js'], /refined/);
    assert.equal(shippedFolder(there.folderOf('shelf')), false, 'a version’s code is laid out, not shipped');
    // ...and the shipped read, from the map or handed the island's registry, gives git's.
    assert.match(shelfs(shippedParts(l))[0].modules!['look.js'], /shipped/);
    assert.deepEqual(shelfs(shippedParts({ registry: there })), [], 'handed a version’s registry, the read draws nothing rather than its code');

    const mine = { is_open: true, props: { preset: 'shelf.row', code: { 'look.js': "export const look = 'kept';\n" } } };
    assert.deepEqual(await refinedOn(l, trial), { pinned: v, parts: ['shelf.row'] });
    assert.deepEqual(await refinedOn(l, plain, [mine]), { parts: ['shelf.row'] }, 'the owner’s version is a refinement too');
    assert.deepEqual(await refinedOn(l, plain, [{ ...mine, is_open: false }]), { parts: ['shelf.row'] }, 'a retired part draws otherwise than it ships');
    assert.match(shelfs(shippedParts(l))[0].modules!['look.js'], /shipped/);

    // The way back unpins the island; then it draws what ships again.
    const island = (await l.entity(trial))!;
    const ops = wayBackOps(island);
    assert.deepEqual(ops, [{ op: 'update', id: trial, props: { pack_version: null } }]);
    await make(l, ops);
    assert.equal(await refinedOn(l, trial), undefined);
    assert.deepEqual(wayBackOps((await l.entity(trial))!), [], 'an island that pins nothing has nothing to unpin');
  } finally {
    hostFor(l.registry).stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a folder laid out from a version or the log is never shipped', () => {
  assert.equal(shippedFolder(join(tmpdir(), 'pelago-code', 'abc', 'shelf')), false);
  assert.equal(shippedFolder(join(tmpdir(), 'pelago-code')), false);
  assert.equal(shippedFolder(join(tmpdir(), 'pelago-codex', 'shelf')), true);
  assert.equal(shippedFolder(join(process.cwd(), 'packs', 'shelf')), true);
});
