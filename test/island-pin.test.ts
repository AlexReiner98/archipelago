// A version of a pack tried on one island (src/island-pin.ts, task e_j4bzhegb): an island that names a version in
// pack_version runs it, its types, fields and instructions; every other island keeps the pack as the map has it, and
// unsetting the island's version brings the old back.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { instructionsFor } from '../src/instructions.ts';
import { Registry } from '../src/packs.ts';
import { setIslands } from '../src/packstate.ts';
import type { Archipelago, Op } from '../src/pelago.ts';
import { callTool } from '../src/tools.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

const OLD = 'Keep things true.', NEW = 'Keep things true, and say why.';

/** An island pack: one type of its own and an instruction said at a session's start. */
const plain = {
  id: 'plain', version: '1.0.0', title: 'Plain', description: 'A pack to try versions with.', requires: ['core'],
  types: [{ id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work' }],
  styles: [{ id: 'plain.tending', type: 'instruction', title: 'Tending', body: OLD, props: { for: ['session_start'] } }],
};

async function map() {
  const l = await freshWith(new Registry(packsWith(plain)));
  await setIslands(l, human, true);
  const made = await make(l, [
    { op: 'create', ref: 'trial', type: 'island', title: 'Trial', props: { pack: 'plain' } },
    { op: 'create', ref: 'rest', type: 'island', title: 'Rest', props: { pack: 'plain' } },
    { op: 'create', ref: 'core', type: 'island', title: 'Plans', props: { pack: 'core' } },
    // The version: the same type with a field more, and the instruction worded anew.
    { op: 'create', ref: 'v2', type: 'pack', title: 'Plain, saying why', props: { version_of: 'plain', version: '1.1.0', manifest: {
      types: [{ id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work', fields: { why: { type: 'string', description: 'Why it is so.' } } }],
      styles: [{ id: 'plain.tending', type: 'instruction', title: 'Tending', body: NEW, props: { for: ['session_start'] } }],
    } } },
  ]);
  return { l, trial: made.trial, rest: made.rest, core: made.core, v2: made.v2 };
}

const refused = (l: Archipelago, ops: Op[], said: RegExp) => assert.rejects(l.change(human, { reason: 'test', ops }), said);
const told = async (l: Archipelago, island?: string) => (await instructionsFor(l, 'session_start', { ...(island && { island }) })).filter((s) => s.preset === 'plain.tending').map((s) => s.text);

test('an island runs the version it names, the rest the pack as it is, and unsetting rolls back', async () => {
  const { l, trial, rest, v2 } = await map();
  assert.ok(l.registry.versions.has(v2), 'a version is kept apart from the packs');
  assert.ok(!l.registry.made.has('plain'), 'and is never a pack of its own');
  assert.deepEqual(await told(l, trial), [OLD], 'before it is set, the island runs the map’s');

  await make(l, [{ op: 'update', id: trial, props: { pack_version: v2 } }]);
  assert.deepEqual(await told(l, trial), [NEW], 'said on the trial island');
  assert.deepEqual(await told(l, rest), [OLD], 'the old everywhere else');
  assert.deepEqual(await told(l), [OLD], 'and where no island is named');
  const view = (await callTool(l, human, 'query', { name: 'instructions', params: { island: trial } })) as { said: { preset?: string; text: string }[] };
  assert.equal(view.said.find((s) => s.preset === 'plain.tending')?.text, NEW, 'the instructions view reads the island');

  // A field the version adds is the trial island's alone.
  const { w } = await make(l, [{ op: 'create', ref: 'w', type: 'plain.thing', title: 'With a why', props: { island: trial, why: 'Because.' } }]);
  await refused(l, [{ op: 'create', type: 'plain.thing', title: 'Without', props: { island: rest, why: 'Because.' } }], /plain\.thing has no field "why"/);

  // A session started on a task there is told what the island says.
  const started = (await callTool(l, agent, 'capture', { action: 'session_start', params: { cwd: '/tmp/trial', task: w } })) as { instructions?: string[] };
  assert.ok(started.instructions?.includes(NEW) && !started.instructions.includes(OLD), 'a session on the trial island hears the version');

  await make(l, [{ op: 'update', id: trial, props: { pack_version: null } }]);
  assert.deepEqual(await told(l, trial), [OLD], 'unset, the island runs the map’s again');
  await refused(l, [{ op: 'create', type: 'plain.thing', title: 'Late', props: { island: trial, why: 'Because.' } }], /has no field "why"/);
});

test('a version keeps its pack’s types, and an island names only a version of its own pack', async () => {
  const { l, trial, core, v2 } = await map();
  await refused(l, [{ op: 'update', id: core, props: { pack_version: v2 } }], /is a version of plain, and this island speaks core/);
  await refused(l, [{ op: 'update', id: trial, props: { pack_version: trial } }], /is no version of a pack here/);
  await refused(l, [{ op: 'create', type: 'pack', title: 'Renamed', props: { version_of: 'plain', manifest: { types: [{ id: 'plain.other', title: 'Other', description: 'Renamed.', extends: 'work' }] } } }], /leaves out plain\.thing; it adds plain\.other/);
  await refused(l, [{ op: 'create', type: 'pack', title: 'Of nothing', props: { version_of: 'nope', manifest: {} } }], /a version of "nope", which is no pack here/);
  await refused(l, [{ op: 'create', type: 'pack', title: 'Of the kernel', props: { version_of: 'core', manifest: {} } }], /the kernel's own/);
  await refused(l, [{ op: 'create', type: 'pack', title: 'With code', props: { version_of: 'plain', manifest: { actions: [] } } }], /holds actions/);
});
