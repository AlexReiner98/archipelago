// Install's copy of the pack model (packs/pack_install/shape.js) against the kernel's (partsOf in
// packs/loader/kernel/pack-model.ts): a pack's code imports nothing of the kernel, so the mapping lives twice, and
// this keeps the two the same. Every pack.json under packs/ goes through both, with made-up file hashes for its
// code, and every item they make, the pack's own and each part's, must come out the same.
// Until the pack model's lane is merged beside this one, the kernel's half is not here and the test says so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error a pack's module, plain JavaScript
import { shipped, stampOf } from '../packs/pack_install/shape.js';

const ROOT = join(import.meta.dirname, '..');
const MODEL = join(ROOT, 'packs/loader/kernel/pack-model.ts');

/** Every pack file the repository has, by its folder. */
const packFiles = () =>
  readdirSync(join(ROOT, 'packs'))
    .filter((d) => existsSync(join(ROOT, 'packs', d, 'pack.json')))
    .map((d) => ({ folder: `packs/${d}`, manifest: JSON.parse(readFileSync(join(ROOT, 'packs', d, 'pack.json'), 'utf8')) }));

/** Install's part as the item the kernel's partsOf answers with: { type, title, body, props }. */
const asModel = (ship: any, part: any) => ({
  type: part.type,
  title: part.title,
  body: part.body,
  props: { ...part.fields, shipped: stampOf(ship, part), ...(part.runs && { runs: part.runs }) },
});

test('install makes of every pack file the items the pack model does', { skip: !existsSync(MODEL) && 'the pack model (packs/loader/kernel/pack-model.ts) is not merged here yet' }, async () => {
  const { partsOf } = await import(pathToFileURL(MODEL).href);
  let compared = 0;
  for (const { folder, manifest } of packFiles()) {
    // Two made-up files, one a module some part may claim, so runs is compared on both sides.
    const files = { 'handler.js': 'a1', 'index.js': 'b2' };
    const theirs = partsOf(manifest, { folder, files });
    const ship = shipped(manifest, { folder, files });
    assert.deepEqual(asModel(ship, ship.pack), theirs.pack, `${folder}: the pack's own item`);
    assert.equal(ship.parts.length, theirs.parts.length, `${folder}: how many parts`);
    ship.parts.forEach((part: any, i: number) => assert.deepEqual(asModel(ship, part), theirs.parts[i], `${folder}: ${part.key}`));
    compared += 1 + ship.parts.length;
  }
  assert.ok(compared > 100, `compared ${compared} items`);
});
