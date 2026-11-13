// Packs moved out of the kernel (packs/loader/kernel/pack-moved.ts): a map that had core while core declared what a pack declares now
// is given that pack, once; a map made after the move, or one whose owner took the pack out, is not.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../packs/database/kernel/db.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { packsOff, setPack, syncPacks } from '../packs/loader/kernel/packstate.ts';
import { declaredIds, holdsMoved } from '../packs/loader/kernel/pack-moved.ts';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { syncTypes } from '../packs/loader/kernel/typetable.ts';
import { human, packsWith } from './map.ts';

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

const ROOT = join(import.meta.dirname, '..');
const read = (pack: string) => JSON.parse(readFileSync(join(ROOT, 'packs', pack, 'pack.json'), 'utf8')) as Record<string, unknown[]>;

/** The packs as they were before the findings pack: its rules, views and styles back in core, and no findings folder. */
function before(): string {
  const dir = packsWith();
  const core = read('core'), findings = read('findings');
  const back = (id: unknown) => (typeof id === 'string' ? id.replace(/^findings\./, 'core.') : id);
  // Its screen of an island's findings stays out: that piece is the findings pack's part now, which no core holds.
  const ofPart = (d: unknown) => ((d as { pieces?: { piece: string }[] }).pieces ?? []).some((p) => p.piece === 'findings');
  for (const key of ['rules', 'views', 'styles'] as const) core[key] = [...core[key], ...(findings[key] ?? []).filter((d) => !ofPart(d)).map((d) => ({ ...(d as object), id: back((d as { id: unknown }).id) }))];
  writeFileSync(join(dir, 'core', 'pack.json'), JSON.stringify(core));
  rmSync(join(dir, 'findings'), { recursive: true });
  return dir;
}

async function mapOn(dir: string, db?: Archipelago["db"]) {
  const reg = new Registry(dir);
  registries.push(reg);
  const l = new Archipelago(db ?? (await openDb()), reg);
  return (await syncTypes(l), l);
}

/** A map made before the move, its packs said on its log. */
async function oldMap() {
  const old = await mapOn(before());
  await old.change(human, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Made before the move' }] });
  await syncPacks(old);
  return old;
}

test('a map that had core before the move is given the findings pack, once, and no other new pack', async () => {
  const old = await oldMap();
  const other: PackFile = { id: 'other', version: '0.1.0', title: 'Other', rules: [{ id: 'other_rule', when: { op: 'create', type: 'task' }, then: 'refuse', say: 'no' }] } as PackFile;
  const now = await mapOn(packsWith(other), old.db);
  const added = (await syncPacks(now)).filter((f) => f[0] === '+' && /pack:(findings|other)$/.test(f[1])).map((f) => f[1]);
  assert.deepEqual(added, ['pack:findings']);
  assert.ok(!(await packsOff(now)).includes('findings'), 'on, as core’s rules were');
  assert.ok((await packsOff(now)).includes('other'), 'a pack that held nothing of core’s waits for the owner');
  assert.deepEqual((await syncPacks(now)).filter((f) => /pack:findings$/.test(f[1])), [], 'once');
});

test('a map whose owner took the findings pack out keeps it out', async () => {
  const old = await oldMap();
  const now = await mapOn(packsWith(), old.db);
  await syncPacks(now);
  await setPack(now, human, { pack: 'findings', on: false });
  assert.deepEqual((await syncPacks(now)).filter((f) => /pack:findings$/.test(f[1])), []);
  assert.ok((await packsOff(now)).includes('findings'));
});

test('a map made after the move is given only what the server starts it with', async () => {
  const was = process.env.PELAGO_START_PACKS;
  process.env.PELAGO_START_PACKS = '';
  try {
    const l = await mapOn(packsWith());
    await syncPacks(l);
    await l.change(human, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Made after the move' }] });
    assert.deepEqual(await syncPacks(l), []);
    assert.ok((await packsOff(l)).includes('findings'));
  } finally {
    if (was === undefined) delete process.env.PELAGO_START_PACKS;
    else process.env.PELAGO_START_PACKS = was;
  }
});

test('a declaration is held again by its id, or by the kernel’s name under the pack’s', () => {
  const gone = new Map([['core', new Set(['finding_value', 'core.moved'])]]);
  const pack = (id: string, ...ids: string[]) => ({ id, version: '0.1.0', title: id, styles: ids.map((i) => ({ id: i })) }) as unknown as PackFile;
  assert.ok(holdsMoved(pack('a', 'finding_value'), gone));
  assert.ok(holdsMoved(pack('findings', 'findings.moved'), gone));
  assert.ok(!holdsMoved(pack('other', 'findings.moved'), gone), 'another pack’s name is not core’s renamed');
  assert.ok(!holdsMoved(pack('b', 'core.kept'), gone));
  assert.deepEqual([...declaredIds({ rules: [{ id: 'r' }], views: [{ id: 'v' }], types: [{ id: 't' }] })], ['r', 'v']);
});

/** The packs as they were before canvas took the look (decision e_fgsgw8ja): its declarations back in core, no canvas folder. */
function beforeCanvas(): string {
  const dir = packsWith();
  const core = read('core'), canvas = read('canvas');
  for (const key of ['views', 'layouts', 'styles'] as const) core[key] = [...(core[key] ?? []), ...(canvas[key] ?? []).filter((d) => (d as { id: string }).id.startsWith('core.'))];
  writeFileSync(join(dir, 'core', 'pack.json'), JSON.stringify(core));
  rmSync(join(dir, 'canvas'), { recursive: true });
  return dir;
}

test('a map that had core before canvas took the look is given canvas, once, and draws in the house style', async () => {
  const old = await mapOn(beforeCanvas());
  await old.change(human, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Made before the move' }] });
  await syncPacks(old);
  const now = await mapOn(packsWith(), old.db);
  assert.ok((await syncPacks(now)).some((f) => f[0] === '+' && /pack:canvas$/.test(f[1])), 'given canvas');
  assert.ok(!(await packsOff(now)).includes('canvas'), 'on, as core’s look was');
  assert.deepEqual((await syncPacks(now)).filter((f) => /pack:canvas$/.test(f[1])), [], 'once');
  await syncTypes(now);
  assert.ok(now.registry.packs.some((p) => (p.layouts ?? []).some((d) => d.id === 'core.map')), 'the map drawing is there under its id');
});
