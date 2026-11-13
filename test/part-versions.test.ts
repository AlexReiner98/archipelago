// What a page drew with (task e_qqp3cuk4): the parts read records the host's commit, the packs a run records and each
// part's hash in the observations stream, once for each set; asked at a past position it answers the parts' code of
// then; a part's change names the host on its log entry.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { entry } from '../packs/log/kernel/log.ts';
import { readOps } from '../packs/log/kernel/streams.ts';
import { headPos } from '../packs/log/kernel/tail.ts';
import { packVersionsFor } from '../packs/loader/kernel/pack-versions.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { syncPacks } from '../packs/loader/kernel/packstate.ts';
import { parts } from '../packs/loader/kernel/parts-read.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { freshWith, human, packsWith } from './map.ts';

const input = { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false };
const SHELF = {
  id: 'shelf', version: '1.0.0', title: 'Shelf', description: 'A part of the page.', requires: ['core'],
  actions: [{ id: 'shelf.put', title: 'Put', description: 'Put it.', verb: 'capture', input }],
  parts: [{ id: 'shelf.row', title: 'Row', slot: 'sheet', marks: ['box', 'text', 'button'], sends: ['shelf.put'], modules: { 'index.js': 'parts/row/index.js' } }],
};
const HANDLER = "export default { 'shelf.put': (input) => ({ ops: [{ op: 'create', type: 'task', title: input.title ?? 'Put' }], reason: 'Put on the shelf' }) };\n";
const row = (dir: string, word: string) => writeFileSync(join(dir, 'shelf', 'parts', 'row', 'index.js'), `export default () => ({ marks: ['text', {}, '${word}'] });\n`);

function folder(): string {
  const dir = packsWith(SHELF as unknown as PackFile);
  writeFileSync(join(dir, 'shelf', 'handler.js'), HANDLER);
  mkdirSync(join(dir, 'shelf', 'parts', 'row'), { recursive: true });
  row(dir, 'row');
  return dir;
}

const HOST = 'a'.repeat(40);
const drewOf = async (l: Awaited<ReturnType<typeof freshWith>>) => (await readOps(l.db, 'observations')).filter((e) => e.facts[0]?.[2] === 'drew');
const shelfOf = (ps: { id: string; hash: string }[]) => ps.find((p) => p.id === 'shelf.row')!;

test('a page records what it drew with once for each set, and redraws a past position with the code of then', async () => {
  const dir = folder();
  const l = await freshWith(new Registry(dir));
  await syncPacks(l);
  const ask = (more: Record<string, unknown> = {}) => parts({ caller: 'query', map: l }, { host: HOST, ...more });

  const first = await ask();
  const drew = first.drew!;
  assert.equal(drew.host, HOST, 'the host the page loaded with');
  assert.deepEqual(drew.packs, await packVersionsFor(l), 'the same packs a run records');
  assert.deepEqual(drew.parts.find((p) => p.id === 'shelf.row'), { id: 'shelf.row', pack: 'shelf', hash: shelfOf(first.parts).hash });
  const recorded = await drewOf(l);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].rule, 'drew', 'kept by core’s rule drew');
  assert.deepEqual(recorded[0].facts[0].slice(0, 3), ['+', 'map', 'drew']);

  await ask();
  assert.equal((await drewOf(l)).length, 1, 'the same set is not recorded again');
  await ask({ host: 'not a commit' });
  const bad = await drewOf(l);
  assert.equal(bad.length, 2, 'another host is another set');
  assert.equal((bad[1].facts[0][3] as { host: unknown }).host, null, 'a host that is no commit is none');

  // The part's code changes: a new set, and the old code is still drawn at the position before.
  const before = await headPos(l.db);
  row(dir, 'changed');
  l.registry.reload();
  await syncPacks(l);
  const now = await ask();
  assert.notEqual(shelfOf(now.parts).hash, shelfOf(first.parts).hash);
  assert.equal((await drewOf(l)).length, 3, 'new code is a new set');
  const then = await ask({ at: before });
  assert.equal(shelfOf(then.parts).hash, shelfOf(first.parts).hash, 'at a past position, the code of then');
  assert.deepEqual(then.at, { pos: before, owners_parts: 'now' });
  assert.equal(then.drew!.at, before);
  assert.equal((await drewOf(l)).length, 3, 'a redraw of the past is not recorded');
});

test('a part’s change names the host the page loaded with', async () => {
  const l = await freshWith(new Registry(folder()));
  const { parts: drawn } = await parts({ caller: 'query', map: l }, {});
  const hash = shelfOf(drawn).hash;
  const done = (await callTool(l, human, 'shelf_put', { title: 'From the row', part: { id: 'shelf.row', hash, host: HOST } })) as { changeset: string };
  assert.deepEqual(((await entry(l.db, done.changeset)) as unknown as { part?: unknown }).part, { id: 'shelf.row', hash, host: HOST });
  const plain = (await callTool(l, human, 'shelf_put', { title: 'No host', part: { id: 'shelf.row', hash, host: 'nope' } })) as { changeset: string };
  assert.deepEqual(((await entry(l.db, plain.changeset)) as unknown as { part?: unknown }).part, { id: 'shelf.row', hash }, 'a host that is no commit is left out');
});
