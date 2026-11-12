// The page reads an item's island version (task e_gh46wf9v): schema with island answers as that island runs, its
// screens, the views it ships of an item and its types' fields, through the read an agent has; an island that runs
// the map's says only that, and the page keeps the map's model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

const thing = { id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work' };
const plain = { id: 'plain', version: '1.0.0', title: 'Plain', description: 'A pack to try versions with.', requires: ['core'], types: [thing] };

type Schema = { runs?: string; version?: { id: string; of: string; title: string }; screens: { id: string; on: string[] }[]; canvases: { id: string; on?: string[] }[]; types: { id: string; fields: Record<string, unknown> }[] };

test('schema with island answers in the version the island runs, and the map’s elsewhere', async () => {
  const l = await freshWith(new Registry(packsWith(plain)));
  await setIslands(l, human, true);
  const { trial, rest, v2 } = await make(l, [
    { op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'plain' } },
    { op: 'create', ref: 'rest', type: 'island', title: 'Rest', props: { pack: 'plain' } },
    // The version: a field more, a screen on its type and a view of one of its items.
    { op: 'create', ref: 'v2', type: 'pack', title: 'Plain, saying why', props: { version_of: 'plain', version: '1.1.0', manifest: {
      types: [{ ...thing, fields: { why: { type: 'string', description: 'Why it is so.' } } }],
      views: [{ form: 'screen', id: 'plain.why', title: 'Why', on: ['plain.thing'], pieces: [{ piece: 'note', text: 'Say why.' }] }],
      styles: [{ id: 'plain.parts', type: 'lens', title: 'Its parts', on: ['plain.thing'], props: { filter: { find: ['part_of {here}'] } } }],
    } } },
  ]);
  await make(l, [{ op: 'update', id: trial, props: { pack_version: v2 } }]);

  const ask = async (island?: string) => (await callTool(l, human, 'query', { name: 'schema', params: island ? { island } : {} })) as Schema;
  const there = await ask(trial), map = await ask(), elsewhere = await ask(rest);
  assert.deepEqual(there.version, { id: v2, of: 'plain', title: 'Plain, saying why' }, 'it names the version');
  assert.ok(there.screens.some((s) => s.id === 'plain.why'), 'the version’s screen');
  assert.ok(there.canvases.some((c) => c.id === 'plain.parts'), 'the version’s view of an item');
  assert.ok('why' in there.types.find((t) => t.id === 'plain.thing')!.fields, 'the version’s fields');

  assert.equal(map.version, undefined);
  assert.ok(!map.screens.some((s) => s.id === 'plain.why') && !map.canvases.some((c) => c.id === 'plain.parts'), 'the map keeps its own');
  assert.ok(!('why' in (map.types.find((t) => t.id === 'plain.thing')!.fields ?? {})));
  assert.deepEqual(elsewhere, { island: rest, runs: 'map' }, 'an island that runs the map’s says only that');
  assert.deepEqual(await ask('e_nothere'), { island: 'e_nothere', runs: 'map' }, 'as does no island');

  // An agent has the same read.
  const brief = (await callTool(l, agent, 'query', { name: 'schema', params: { island: trial, type: 'plain.thing' } })) as { version?: { id: string } };
  assert.equal(brief.version?.id, v2);

  // Unsetting the version is the rollback: the island answers with the map's again.
  await make(l, [{ op: 'update', id: trial, props: { pack_version: null } }]);
  assert.deepEqual(await ask(trial), { island: trial, runs: 'map' });
});
