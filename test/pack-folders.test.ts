// Packs from more than one folder (PELAGO_PACKS): a hosted server keeps the packs it sells in a folder of its own,
// beside the open core's, so a type pack need not be a file of the public repository (decision e_8jd82drh, 9 Nov 2026).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../packs/database/kernel/db.ts';
import { presetsOf } from '../packs/loader/kernel/declared.ts';
import * as instructionsPack from '../packs/agents/kernel/instructions.ts';
import { manifestRead } from '../packs/loader/kernel/pack-folders.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { packsOff, syncPacks } from '../packs/loader/kernel/packstate.ts';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { checkServerPack, loadServerPacks, OWN_PACKS } from '../packs/loader/kernel/server-packs.ts';
import { syncTypes } from '../packs/loader/kernel/typetable.ts';
import { PACKS, packsWith } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

/** A pack written for the test, as a hosted folder would hold one. */
const GRANTS = { id: 'grants', version: '1', title: 'Grants', description: 'A pack kept in a folder of its own.', requires: ['core'], types: [{ id: 'grant', title: 'Grant', description: 'A grant applied for.', extends: 'record' }] };

/** Folders of packs: core copied from the repository, grants written out. */
const folders = (...packs: string[][]) => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-pack-folders-'));
  const dirs = packs.map((ids, i) => {
    const dir = join(root, String(i));
    for (const id of ids) {
      if (id === 'core') cpSync(join(PACKS, id), join(dir, id), { recursive: true });
      else (mkdirSync(join(dir, id), { recursive: true }), writeFileSync(join(dir, id, 'pack.json'), JSON.stringify(GRANTS)));
    }
    return dir;
  });
  return { dirs, done: () => rmSync(root, { recursive: true, force: true }) };
};

test('a pack in a second folder loads beside the first folder’s, and its files are found where it is', () => {
  const { dirs, done } = folders(['core'], ['grants']);
  try {
    const reg = new Registry(dirs);
    assert.equal(reg.states.get('grants')?.state, 'active', String(reg.states.get('grants')?.why));
    assert.ok(reg.types.has('grant'), 'its types are registered');
    assert.equal(reg.folderOf('grants'), join(dirs[1], 'grants'));
    assert.equal(reg.folderOf('core'), join(dirs[0], 'core'));
    assert.deepEqual(reg.trial([]).dirs, dirs, 'a trial reads the same folders');
  } finally {
    done();
  }
});

test('the same pack id in two folders is refused, naming both', () => {
  const { dirs, done } = folders(['core', 'grants'], ['grants']);
  try {
    assert.throws(() => new Registry(dirs), /Pack "grants" is in two pack folders: .+ and .+/);
  } finally {
    done();
  }
});

test('one folder, as given before, is read as it was', () => {
  const reg = new Registry(PACKS);
  assert.deepEqual(reg.dirs, [PACKS]);
  assert.equal(reg.folderOf('core'), join(PACKS, 'core'));
});

// A server pack carries a workspace half (task e_jpcsbt48): a workspace.json beside its pack.json, read by every
// workspace's registry as a workspace pack of the same id, so one subsystem is one pack on the server and on a map.
const SERVER = { id: 'relay', version: '1', title: 'Relay', description: 'A server pack.', reach: { server: { acts: ['mail.send' as const] } } };
const HALF = { id: 'relay', version: '1', title: 'Relay', description: 'Its workspace half.', styles: [{ id: 'relay.hint', type: 'instruction', title: 'A hint', body: 'Said on a map.', props: { for: ['session_start'] } }] };

const serverFolder = (half?: object) => {
  const { dirs, done } = folders(['core']);
  mkdirSync(join(dirs[0], 'relay'));
  writeFileSync(join(dirs[0], 'relay', 'pack.json'), JSON.stringify(SERVER));
  if (half) writeFileSync(join(dirs[0], 'relay', 'workspace.json'), JSON.stringify(half));
  return { dirs, done };
};

test('a server pack with no workspace half is the server’s alone; with one, a workspace reads the half', () => {
  let { dirs, done } = serverFolder();
  try {
    assert.ok(!new Registry(dirs).states.has('relay'));
  } finally {
    done();
  }
  ({ dirs, done } = serverFolder(HALF));
  try {
    const reg = new Registry(dirs);
    assert.equal(reg.states.get('relay')?.state, 'active', String(reg.states.get('relay')?.why));
    const pack = reg.found.find((p) => p.id === 'relay')!;
    assert.equal(pack.reach?.server, undefined, 'the half, not the server’s file');
    assert.deepEqual(presetsOf([pack], 'instruction').map((s) => s.id), ['relay.hint']);
    assert.equal(reg.hashes.get('relay'), createHash('sha256').update(JSON.stringify(HALF)).digest('hex'), 'its hash is the half’s text');
    assert.equal(manifestRead(reg.hashes.get('relay')), JSON.stringify(HALF), 'and the log keeps that text');
    assert.equal(reg.folderOf('relay'), join(dirs[0], 'relay'));
    assert.deepEqual(checkServerPack(SERVER, join(dirs[0], 'relay')), [], 'and the server pack is still right');
  } finally {
    done();
  }
});

test('a workspace half keeps its pack’s id and asks for no server reach', () => {
  for (const [half, why] of [
    [{ ...HALF, id: 'other' }, /a half keeps its pack's id/],
    [{ ...HALF, reach: SERVER.reach }, /asks for server reach/],
  ] as const) {
    const { dirs, done } = serverFolder(half);
    try {
      assert.throws(() => new Registry(dirs), why);
      assert.match(checkServerPack(SERVER, join(dirs[0], 'relay')).join('; '), why, 'and the server refuses the pack, not half of it');
    } finally {
      done();
    }
  }
});

test('claude_code’s workspace half says setup_behind, and neither core nor practice holds it', () => {
  const reg = new Registry(PACKS);
  assert.equal(reg.states.get('claude_code')?.state, 'active', String(reg.states.get('claude_code')?.why));
  const said = presetsOf(reg.found, 'instruction').filter((s) => (s.props?.for as string[] | undefined)?.includes('setup_behind'));
  assert.deepEqual(said.map((s) => [s.id, s.pack]), [['core.setup_behind', 'claude_code']]);
  assert.ok(loadServerPacks([OWN_PACKS]).packs.some((p) => p.file.id === 'claude_code'), 'and its server half still loads');
});

test('a map that had setup_behind from practice is given claude_code’s half, once, and is still told it', async () => {
  const dir = packsWith();
  const practice = JSON.parse(readFileSync(join(dir, 'practice', 'pack.json'), 'utf8'));
  const half = JSON.parse(readFileSync(join(dir, 'claude_code', 'workspace.json'), 'utf8'));
  writeFileSync(join(dir, 'practice', 'pack.json'), JSON.stringify({ ...practice, styles: [...practice.styles, ...half.styles] }));
  rmSync(join(dir, 'claude_code', 'workspace.json'));
  const regs: Registry[] = [];
  const on = async (db?: Archipelago['db']) => {
    const reg = new Registry(dirFor(db));
    regs.push(reg);
    const l = new Archipelago(db ?? (await openDb()), reg);
    return (await syncTypes(l), l);
  };
  const dirFor = (db?: unknown) => (db ? packsWith() : dir);
  try {
    const old = await on();
    await syncPacks(old);
    const now = await on(old.db);
    assert.deepEqual((await syncPacks(now)).filter((f) => /pack:claude_code$/.test(f[1])).map((f) => f[0]), ['+']);
    assert.ok(!(await packsOff(now)).includes('claude_code'));
    assert.deepEqual((await syncPacks(now)).filter((f) => /pack:claude_code$/.test(f[1])), [], 'once');
    const said = await instructionsPack.instructionsFor(kernelContext(now, 'agents'), 'setup_behind', ({ fill: { command: 'npx setup' } }));
    assert.deepEqual(said.map((s) => s.preset), ['core.setup_behind']);
    assert.match(said[0].text, /npx setup/);
  } finally {
    regs.forEach((r) => hostFor(r).stop());
  }
});
