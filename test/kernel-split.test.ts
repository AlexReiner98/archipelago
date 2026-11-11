// Packs split out of the kernel (the core audit, e_sjhbyf52; src/packorder.ts, splitFromKernel): a pack that keeps a
// kernel name for a view or preset it took over is on in every map, new or old, as what it holds was, until the owner
// takes it out; and what names those ids (an instruction's preset, a screen on a run's page) still finds them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { instructionsFor } from '../src/instructions.ts';
import { keptFromKernel, splitFromKernel } from '../src/packorder.ts';
import { Registry } from '../src/packs.ts';
import { packsOff, setPack, syncPacks } from '../src/packstate.ts';
import { Archipelago } from '../src/pelago.ts';
import { syncTypes } from '../src/typetable.ts';
import { human, PACKS } from './map.ts';

/** Run with no distribution: a new map starts with the kernel's packs alone. */
async function bare<T>(fn: () => Promise<T>): Promise<T> {
  const was = process.env.PELAGO_START_PACKS;
  delete process.env.PELAGO_START_PACKS;
  try {
    return await fn();
  } finally {
    if (was === undefined) delete process.env.PELAGO_START_PACKS;
    else process.env.PELAGO_START_PACKS = was;
  }
}

const open = async (db: Awaited<ReturnType<typeof openDb>>, only?: string[]) => {
  const l = new Archipelago(db, new Registry(PACKS, only));
  return (await syncTypes(l), l);
};

test('a pack split out of the kernel keeps its names, and only a kernel pack’s', () => {
  assert.ok(keptFromKernel('core.report_in') && !keptFromKernel('corey.x') && !keptFromKernel('work.x'));
  assert.equal(splitFromKernel({ id: 'core', styles: [{ id: 'core.x', title: 'X', props: {} }] }), false, 'the kernel is not split from itself');
  assert.equal(splitFromKernel({ id: 'other', styles: [{ id: 'other.x', title: 'X', props: {} }] }), false);
  assert.equal(splitFromKernel({ id: 'other', styles: [{ id: 'core.x', title: 'X', props: {} }] }), true);
});

test('every map has the packs split out of the kernel: a new one, and one that had only core', async () => {
  await bare(async () => {
    const fresh = await open(await openDb());
    await syncPacks(fresh);
    const split = fresh.registry.found.filter(splitFromKernel).map((p) => p.id);
    assert.ok(split.length, 'the repository ships at least one');
    assert.ok(!(await packsOff(fresh)).some((p) => split.includes(p)), 'on in a new map');
    for (const p of split) assert.equal(fresh.registry.states.get(p)?.state, 'active', `${p} is active`);

    // A map whose log said core before the split: opened on a server with the split pack, it is added, once.
    const db = await openDb();
    const before = await open(db, ['core']);
    await syncPacks(before);
    await before.change(human, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Made before the split' }] });
    const after = await open(db);
    assert.deepEqual((await syncPacks(after)).map((f) => f[1]).sort(), split.map((p) => `pack:${p}`).sort(), 'added to a map that had core');
    assert.deepEqual(await syncPacks(after), [], 'once');
    // What a session is told at its start is as it was before the split.
    const said = (await instructionsFor(after, 'session_start', { fill: { run: 'r' } })).map((s) => s.preset);
    assert.ok(said.includes('core.report_in') && said.includes('core.estimate'), 'a session is still told to report in');

    // Taken out by the owner, it stays out.
    await setPack(after, human, { pack: split[0], on: false });
    await syncPacks(after);
    assert.ok((await packsOff(after)).includes(split[0]), 'the owner took it out, and it stays out');
  });
});
