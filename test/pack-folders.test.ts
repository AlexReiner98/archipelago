// Packs from more than one folder (PELAGO_PACKS): a hosted server keeps the packs it sells in a folder of its own,
// beside the open core's, so a type pack need not be a file of the public repository (decision e_8jd82drh, 9 Nov 2026).
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry } from '../src/packs.ts';
import { PACKS } from './map.ts';

const folders = (...packs: string[][]) => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-pack-folders-'));
  const dirs = packs.map((ids, i) => {
    const dir = join(root, String(i));
    for (const id of ids) cpSync(join(PACKS, id), join(dir, id), { recursive: true });
    return dir;
  });
  return { dirs, done: () => rmSync(root, { recursive: true, force: true }) };
};

test('a pack in a second folder loads beside the first folder’s, and its files are found where it is', () => {
  const { dirs, done } = folders(['core'], ['funding']);
  try {
    const reg = new Registry(dirs);
    assert.equal(reg.states.get('funding')?.state, 'active', String(reg.states.get('funding')?.why));
    assert.ok(reg.types.has('program'), 'its types are registered');
    assert.equal(reg.folderOf('funding'), join(dirs[1], 'funding'));
    assert.equal(reg.folderOf('core'), join(dirs[0], 'core'));
    assert.deepEqual(reg.trial([]).dirs, dirs, 'a trial reads the same folders');
  } finally {
    done();
  }
});

test('the same pack id in two folders is refused, naming both', () => {
  const { dirs, done } = folders(['core', 'funding'], ['funding']);
  try {
    assert.throws(() => new Registry(dirs), /Pack "funding" is in two pack folders: .+ and .+/);
  } finally {
    done();
  }
});

test('one folder, as given before, is read as it was', () => {
  const reg = new Registry(PACKS);
  assert.deepEqual(reg.dirs, [PACKS]);
  assert.equal(reg.folderOf('core'), join(PACKS, 'core'));
});
