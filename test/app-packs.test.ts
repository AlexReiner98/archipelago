// The app's own screens as packs (`app` in a manifest, decision e_y9dcs4nv, task e_rrwdv26d): on in every map, existing
// and new, without anyone adding them, until that map's owner takes one out, and then it stays out.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { packsOff, setPack, syncPacks } from '../packs/loader/kernel/packstate.ts';
import { syncTypes } from '../packs/loader/kernel/typetable.ts';
import { openDb, type Db } from '../packs/database/kernel/db.ts';
import { human, packsWith } from './map.ts';

/** A map on this database, opened with the packs of these folders, on a server that starts a new map with the kernel's alone (the test runner starts with every pack), and allows only `only` where it names a list. */
async function open(db: Db, dirs: string | string[], only?: string[]) {
  const was = process.env.PELAGO_START_PACKS;
  process.env.PELAGO_START_PACKS = 'core';
  try {
    const l = new Archipelago(db, new Registry(dirs, only));
    await syncTypes(l);
    await syncPacks(l);
    l.registry.turnOff(await packsOff(l), false);
    return l;
  } finally {
    if (was === undefined) delete process.env.PELAGO_START_PACKS;
    else process.env.PELAGO_START_PACKS = was;
  }
}

const PROBE = join(import.meta.dirname, 'packs', 'app_probe');

test("an app pack is on in a map that existed before it, and in a new one, until the owner takes it out", async () => {
  const before = packsWith();
  const after = packsWith('app_probe');
  try {
    // A map that has run for a while: its packs are facts on its log, and app_probe is not among them.
    const db = await openDb();
    await open(db, before);
    // The server gains the pack: no one adds it, and it is on.
    const l = await open(db, after);
    assert.ok(!(await packsOff(l)).includes('app_probe'), 'on without being added');
    assert.equal(l.registry.states.get('app_probe')?.state, 'active');
    // The owner takes it out, and that holds as the map opens again.
    await setPack(l, human, { pack: 'app_probe', on: false });
    assert.ok((await packsOff(l)).includes('app_probe'), 'off once taken out');
    const again = await open(db, after);
    assert.ok((await packsOff(again)).includes('app_probe'), 'still off when the map opens again');
    assert.notEqual(again.registry.states.get('app_probe')?.state, 'active');
    await setPack(again, human, { pack: 'app_probe', on: true });
    assert.ok(!(await packsOff(again)).includes('app_probe'), 'and on again when the owner adds it back');

    // A new map has it too.
    const fresh = await open(await openDb(), after);
    assert.ok(!(await packsOff(fresh)).includes('app_probe'), 'on in a new map');
  } finally {
    rmSync(before, { recursive: true, force: true });
    rmSync(after, { recursive: true, force: true });
  }
});

test("an app pack is on where the server names a list of packs that leaves it out", async () => {
  const own = packsWith('app_probe');
  try {
    // A hosted server allows a list (PELAGO_ONLY_PACKS) that names no app pack: the app's own screens stay on.
    const db = await openDb();
    await open(db, own, ['core']);
    const l = await open(db, own, ['core']);
    assert.ok(!(await packsOff(l)).includes('app_probe'), 'on in a map that has packs on its log');
    assert.equal(l.registry.states.get('app_probe')?.state, 'active', 'and loaded, not "not enabled on this server"');
  } finally {
    rmSync(own, { recursive: true, force: true });
  }
});

test("the mark counts only on a pack of the server's own folder", async () => {
  const own = packsWith();
  const other = mkdtempSync(join(tmpdir(), 'pelago-hosted-'));
  cpSync(PROBE, join(other, 'app_probe'), { recursive: true });
  try {
    const l = await open(await openDb(), [own, other]);
    assert.ok((await packsOff(l)).includes('app_probe'), 'a pack from another folder is the owner\'s to add, whatever it says');
  } finally {
    rmSync(own, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});
