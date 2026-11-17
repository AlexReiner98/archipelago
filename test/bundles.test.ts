// Bundles (packs/loader/kernel/bundles.ts): packs that go on and off together, as one owner action and one change set, offered only
// where the server's list offers every pack in them, and named by a distribution (PELAGO_START_PACKS).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Archipelago } from '../packs/write/kernel/pelago.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { expandBundles, packsNamed, readBundle, readBundles } from '../packs/loader/kernel/bundles.ts';
import { bundlesHere, packStates, packsOff, setPack, syncPacks } from '../packs/loader/kernel/packstate.ts';
import { syncTypes } from '../packs/loader/kernel/typetable.ts';
import { openDb } from '../packs/database/kernel/db.ts';
import { human, packsWith, PACKS } from './map.ts';
import type { PackFile } from '../packs/loader/kernel/packs.ts';

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

/** The repository's packs with a bundle beside them: tide_words (a type) and tide_view (a view of it), as "tides". */
function withTides(): string {
  const dir = packsWith(
    { id: 'tide_words', version: '0.1.0', title: 'Tide words', description: 'A reading of the tide.', types: [{ id: 'tide_words.reading', extends: 'record', title: 'Reading', description: 'A height of water.' }] } as unknown as PackFile,
    { id: 'tide_view', version: '0.1.0', title: 'Tide view', description: 'The readings, as a list.' } as unknown as PackFile,
  );
  mkdirSync(join(dir, 'tides'));
  writeFileSync(join(dir, 'tides', 'bundle.json'), JSON.stringify({ id: 'tides', title: 'Tides', description: 'Readings and their view, on and off together.', packs: ['tide_words', 'tide_view'] }));
  return dir;
}
const PAIR = ['tide_view', 'tide_words'];

test('a bundle in a folder of packs is read with its packs', () => {
  const [b] = readBundles([withTides()], PAIR).filter((x) => x.id === 'tides');
  assert.deepEqual(b.packs, ['tide_words', 'tide_view']);
  assert.deepEqual(readBundles([PACKS], ['core']), [], 'the repository ships none');
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
  const l = await mapOf(withTides());
  await starting('core', () => syncPacks(l));
  assert.deepEqual((await packsOff(l)).filter((p) => PAIR.includes(p)).sort(), PAIR, 'both off on a new map');
  assert.deepEqual(bundlesHere(l).map((b) => b.id), ['tides']);
  const states = packStates(l);
  for (const id of PAIR) assert.equal(states.find((p) => p.id === id)?.bundle?.id, 'tides', `${id} names its bundle`);
  assert.equal(states.find((p) => p.id === 'core')?.bundle, undefined);

  const before = await lastPos(l);
  await setPack(l, human, { pack: 'tides', on: true });
  assert.ok(!(await packsOff(l)).some((p) => PAIR.includes(p)), 'both on');
  assert.equal((await saidAt(l, PAIR, '+', before)).length, 1, 'said in one change set');
  assert.equal(l.registry.states.get('tide_words')!.state, 'active');
  assert.equal(l.registry.states.get('tide_view')!.state, 'active');

  const on = await lastPos(l);
  await setPack(l, human, { pack: 'tide_words', on: false });
  assert.deepEqual((await packsOff(l)).filter((p) => PAIR.includes(p)).sort(), PAIR, 'a pack of it takes the whole bundle out');
  assert.equal((await saidAt(l, PAIR, '-', on)).length, 1);
  await assert.rejects(setPack(l, { kind: 'agent', name: 'a' } as never, { pack: 'tides', on: true }), /owner/);
});

test("a bundle is offered only where the server's list offers all its packs; else its packs stand alone", async () => {
  const l = await mapOf(withTides(), ['core', 'tide_view']);
  assert.deepEqual(bundlesHere(l), []);
  assert.equal(packStates(l).find((p) => p.id === 'tide_view')?.bundle, undefined, 'tide_view stands alone here');
  await setPack(l, human, { pack: 'tide_view', on: true });
  assert.ok(!(await packsOff(l)).includes('tide_view'));
  await assert.rejects(setPack(l, human, { pack: 'tide_words', on: true }), /not offered/);
  await assert.rejects(setPack(l, human, { pack: 'tides', on: true }), /No pack "tides"/);
});

test('a distribution names a bundle: a new map starts with its packs', async () => {
  const l = await mapOf(withTides());
  assert.deepEqual((await starting('tides', () => syncPacks(l))).map((f) => f[1]).sort(), ['pack:attention', 'pack:canvas', 'pack:claude_code', 'pack:core', 'pack:practice', 'pack:sessions', 'pack:tide_view', 'pack:tide_words', 'pack:views']);
});
