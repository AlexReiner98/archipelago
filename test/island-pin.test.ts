// A version of a pack tried on one island (packs/loader/kernel/island-pin.ts, task e_j4bzhegb): an island that names a version in
// pack_version runs it, its types, fields and instructions; every other island keeps the pack as the map has it, and
// unsetting the island's version brings the old back.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as instructionsPack from '../packs/agents/kernel/instructions.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import type { Archipelago, Op } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

const OLD = 'Keep things true.', NEW = 'Keep things true, and say why.';

/** An island pack: one type of its own and an instruction said at a session's start. */
const plain = {
  id: 'plain', version: '1.0.0', title: 'Plain', description: 'A pack to try versions with.', requires: ['core'],
  types: [{ id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work' }],
  styles: [{ id: 'plain.tending', type: 'instruction', title: 'Tending', body: OLD, props: { for: ['session_start'] } }],
};

/** A map pack that asks for trees: core declares no tree read (it went to work_views, task e_2a94ypah). */
const reads = { id: 'reads', version: '1.0.0', title: 'Reads', description: 'The tree read.', requires: ['core'], views: [{ id: 'reads.tree', shape: 'data', lens: {}, answer: 'tree', description: 'A tree a pack declares.' }] } as unknown as PackFile;

async function map() {
  const l = await freshWith(new Registry(packsWith(plain, reads)));
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
const told = async (l: Archipelago, island?: string) => (await instructionsPack.instructionsFor(kernelContext(l, 'agents'), 'session_start', ({ ...(island && { island }) }))).filter((s) => s.preset === 'plain.tending').map((s) => s.text);

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
  await refused(l, [{ op: 'create', type: 'pack', title: 'Of nothing', props: { version_of: 'nope', manifest: {} } }], /a version of "nope", which is no pack here/);
  await refused(l, [{ op: 'create', type: 'pack', title: 'Of the kernel', props: { version_of: 'core', manifest: {} } }], /the kernel's own/);
  await refused(l, [{ op: 'create', type: 'pack', title: 'With code', props: { version_of: 'plain', manifest: { actions: [] } } }], /holds actions/);
});

/** A version that adds a type and a link type, and a tree over them in its views. */
const growing = { op: 'create', ref: 'v3', type: 'pack', title: 'Plain, with parts', props: { version_of: 'plain', version: '1.2.0', manifest: {
  types: [...plain.types, { id: 'plain.part', title: 'Part', description: 'A part of a thing.', extends: 'work' }],
  links: [{ id: 'plain.feeds', title: 'feeds', description: 'One thing feeds another.', from: ['plain.thing'], to: ['plain.thing'] }],
  views: [{ form: 'tree', id: 'plain.parts', title: 'Parts', description: 'Each thing and its parts.', roots: ['plain.thing'], branches: ['plain.part'], work: [], order: 'order', active: ['doing'] }],
} } } as Op;

test('a version may add types, link types and views: they are the pinned island’s alone', async () => {
  const { l, trial, rest } = await map();
  const { v3 } = await make(l, [growing]);
  await make(l, [{ op: 'update', id: trial, props: { pack_version: v3 } }]);
  const { a, b, p } = await make(l, [
    { op: 'create', ref: 'a', type: 'plain.thing', title: 'Engine', props: { island: trial } },
    { op: 'create', ref: 'b', type: 'plain.thing', title: 'Wheel', props: { island: trial } },
    { op: 'create', ref: 'p', type: 'plain.part', title: 'Piston', props: { island: trial } },
  ]);
  await make(l, [{ op: 'link', type: 'part_of', from: p, to: a }, { op: 'link', type: 'plain.feeds', from: a, to: b }]);
  await refused(l, [{ op: 'create', type: 'plain.part', title: 'Elsewhere', props: { island: rest } }], /plain\.part/);
  const { c } = await make(l, [{ op: 'create', ref: 'c', type: 'plain.thing', title: 'Rest thing', props: { island: rest } }]);
  await refused(l, [{ op: 'link', type: 'plain.feeds', from: c, to: a }], /plain\.feeds/);

  // The version's tree answers a read on its island, and is no view of the map's.
  const parts = (await callTool(l, human, 'query', { name: 'tree', params: { tree: 'plain.parts', root: a, island: trial } })) as { tree: { id: string }; root: { id: string }; branches: { id: string }[] };
  assert.equal(parts.tree.id, 'plain.parts');
  assert.deepEqual([parts.root.id, parts.branches.map((x) => x.id)], [a, [p]], 'the thing and its part');
  await assert.rejects(callTool(l, human, 'query', { name: 'tree', params: { tree: 'plain.parts', root: a } }), /tree must be one of/);
  await assert.rejects(callTool(l, human, 'query', { name: 'tree', params: { tree: 'plain.parts', root: a, island: rest } }), /tree must be one of/);

  // The map keeps what the version adds, dormant, so its items are projected as their type says; rolled back, none is made.
  assert.ok(l.registry.type('plain.part')?.dormant && l.registry.type('plain.part')?.retired, 'the map has the added type, and makes none of it');
  assert.equal((await l.entity(p))?.status, 'todo', 'the part was made with its type’s first status');
  await make(l, [{ op: 'update', id: trial, props: { pack_version: null } }]);
  await refused(l, [{ op: 'create', type: 'plain.part', title: 'After', props: { island: trial } }], /retired here/);
});

test('a version never leaves out a type, and names what it adds as its pack’s', async () => {
  const { l } = await map();
  await refused(l, [{ op: 'create', type: 'pack', title: 'Dropping', props: { version_of: 'plain', manifest: { types: [{ id: 'plain.other', title: 'Other', description: 'Renamed.', extends: 'work' }] } } }], /leaves out plain\.thing/);
  await refused(l, [{ op: 'create', type: 'pack', title: 'Misnamed', props: { version_of: 'plain', manifest: { types: [...plain.types, { id: 'other.part', title: 'Part', description: 'A part.', extends: 'work' }] } } }], /named plain\.<what>: other\.part/);
});
