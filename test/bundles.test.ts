// Bundles (src/bundles.ts): packs that go on and off together, as one owner action and one change set, offered only
// where the server's list offers every pack in them, and named by a distribution (PELAGO_START_PACKS).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Archipelago } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { expandBundles, packsNamed, readBundle, readBundles } from '../src/bundles.ts';
import { bundlesHere, packStates, packsOff, setPack, syncPacks } from '../src/packstate.ts';
import { syncTypes } from '../src/typetable.ts';
import { openDb } from '../src/db.ts';
import { human, packsWith, PACKS } from './map.ts';

async function mapOf(dir: string, only?: string[]) {
  const reg = new Registry(dir, only);
  const l = new Archipelago(await openDb(), reg);
  return (await syncTypes(l), l);
}

/** The positions on the log after `since` at which a pack's presence was said, for these packs. */
/** The last position on the facts stream. */
const lastPos = async (l: Archipelago) => (await l.db.query<{ pos: string }>(`select coalesce(max(pos), 0) as pos from log_fact where stream = 'facts'`)).rows[0].pos;

async function saidAt(l: Archipelago, packs: string[], op: '+' | '-', since: string) {
  const { rows } = await l.db.query<{ pos: string }>(`select distinct pos from log_fact where stream = 'facts' and field = 'pack' and op = $2 and id = any($1::text[]) and pos > $3`, [packs.map((p) => `pack:${p}`), op, since]);
  return rows.map((r) => r.pos);
}

test('a bundle manifest has its own keys, two or more packs, and an id no pack has', () => {
  assert.deepEqual(readBundle(JSON.stringify({ id: 'pair', title: 'Pair', packs: ['a', 'b'] }), 'pair'), { id: 'pair', title: 'Pair', packs: ['a', 'b'] });
  assert.throws(() => readBundle(JSON.stringify({ id: 'pair', title: 'Pair', packs: ['a'] }), 'pair'), /two or more/);
  assert.throws(() => readBundle(JSON.stringify({ id: 'pair', title: 'Pair', packs: ['a', 'a'] }), 'pair'), /each once/);
  assert.throws(() => readBundle(JSON.stringify({ id: 'pair', title: 'Pair', packs: ['a', 'b'], requires: [] }), 'pair'), /unknown key requires/);
  const dir = mkdtempSync(join(tmpdir(), 'pelago-bundles-'));
  const put = (name: string, b: object) => (mkdirSync(join(dir, name)), writeFileSync(join(dir, name, 'bundle.json'), JSON.stringify(b)));
  put('one', { id: 'one', title: 'One', packs: ['a', 'b'] });
  assert.throws(() => readBundles([dir], ['a', 'b', 'one']), /a pack's id/);
  put('two', { id: 'two', title: 'Two', packs: ['b', 'c'] });
  assert.throws(() => readBundles([dir], ['a', 'b', 'c']), /"b" is in two bundles/);
  const bundles = [{ id: 'one', title: 'One', packs: ['a', 'b'] }];
  assert.deepEqual(packsNamed(bundles, 'b'), { packs: ['a', 'b'], bundle: bundles[0] }, 'a bundled pack stands for its bundle');
  assert.deepEqual(packsNamed(bundles, 'c'), { packs: ['c'] });
  assert.deepEqual(expandBundles(['one', 'c', 'a'], bundles), ['a', 'b', 'c']);
});

test('refine and replays are the refinement bundle', () => {
  const [b] = readBundles([PACKS], ['refine', 'replays']).filter((x) => x.id === 'refinement');
  assert.deepEqual(b.packs, ['refine', 'replays']);
});

/** Run with a distribution: what a new map starts with (the test runner starts with every pack). */
async function starting<T>(said: string, fn: () => Promise<T>): Promise<T> {
  const was = process.env.PELAGO_START_PACKS;
  process.env.PELAGO_START_PACKS = said;
  try {
    return await fn();
  } finally {
    if (was === undefined) delete process.env.PELAGO_START_PACKS;
    else process.env.PELAGO_START_PACKS = was;
  }
}

test('a bundle turns on and off as one, in one change set, by its id or a pack of it', async () => {
  const l = await mapOf(packsWith());
  await starting('core', () => syncPacks(l));
  assert.deepEqual((await packsOff(l)).filter((p) => p === 'refine' || p === 'replays').sort(), ['refine', 'replays'], 'both off on a new map');
  assert.deepEqual(bundlesHere(l).map((b) => b.id), ['refinement']);
  const states = packStates(l);
  for (const id of ['refine', 'replays']) assert.equal(states.find((p) => p.id === id)?.bundle?.id, 'refinement', `${id} names its bundle`);
  assert.equal(states.find((p) => p.id === 'core')?.bundle, undefined);

  const before = await lastPos(l);
  await setPack(l, human, { pack: 'refinement', on: true });
  assert.ok(!(await packsOff(l)).some((p) => p === 'refine' || p === 'replays'), 'both on');
  assert.equal((await saidAt(l, ['refine', 'replays'], '+', before)).length, 1, 'said in one change set');
  assert.equal(l.registry.states.get('refine')!.state, 'active');
  assert.equal(l.registry.states.get('replays')!.state, 'active');

  const on = await lastPos(l);
  await setPack(l, human, { pack: 'replays', on: false });
  assert.deepEqual((await packsOff(l)).filter((p) => p === 'refine' || p === 'replays').sort(), ['refine', 'replays'], 'a pack of it takes the whole bundle out');
  assert.equal((await saidAt(l, ['refine', 'replays'], '-', on)).length, 1);
  await assert.rejects(setPack(l, { kind: 'agent', name: 'a' } as never, { pack: 'refinement', on: true }), /owner/);
});

test("a bundle is offered only where the server's list offers all its packs; else its packs stand alone", async () => {
  const l = await mapOf(packsWith(), ['core', 'refine']);
  assert.deepEqual(bundlesHere(l), []);
  assert.equal(packStates(l).find((p) => p.id === 'refine')?.bundle, undefined, 'refine stands alone here');
  await setPack(l, human, { pack: 'refine', on: true });
  assert.ok(!(await packsOff(l)).includes('refine'));
  await assert.rejects(setPack(l, human, { pack: 'replays', on: true }), /not offered/);
  await assert.rejects(setPack(l, human, { pack: 'refinement', on: true }), /No pack "refinement"/);
});

test('a distribution names a bundle: a new map starts with its packs', async () => {
  const l = await mapOf(packsWith());
  assert.deepEqual((await starting('refinement', () => syncPacks(l))).map((f) => f[1]).sort(), ['pack:core', 'pack:refine', 'pack:replays']);
});
