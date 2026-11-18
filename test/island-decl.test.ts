// What the island answer says of a pack's parts (packs/loader/kernel/island-decl.ts, feature e_4r82mvf3, lane
// e_t8gnj96e): each island gives its parts_off, and its pack and each it requires give their parts with each one's
// state there (active, off, waiting with what it lacks), the names they give (type:<id>), the names they take with the
// pack that gives each, and what a waiting pack lacks. The island part glyphs read it (packs/canvas/layouts/flow/pack-marks.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import * as queryFlatPack from '../packs/query/kernel/query-flat.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';
import { freshWith, human, make, packsWith } from './map.ts';

const build = {
  id: 'build', version: '1.0.0', title: 'Build', description: 'Features in lanes.', requires: ['core'],
  types: [
    { id: 'build.feature', title: 'Feature', description: 'What is built.', extends: 'work' },
    { id: 'build.overlap', title: 'Overlap', description: 'Two lanes touching one file.', extends: 'work' },
  ],
  links: [{ id: 'build.touches', title: 'Touches', inverse: 'Touched by', extends: 'about', from: ['build.overlap'], to: ['build.feature'], description: 'An overlap in a feature.' }],
  rules: [{ id: 'build.watched', when: { actor: 'agent' as const, op: 'update' as const, type: 'build.overlap' }, then: 'hold' as const, say: 'An overlap changed by an agent waits.' }],
};
const design = {
  id: 'design', version: '1.0.0', title: 'Design', description: 'Studies of a feature.', requires: ['core', 'type:build.feature'],
  types: [{ id: 'design.study', title: 'Study', description: 'A design study.', extends: 'build.feature' }],
};

async function map() {
  const l = await freshWith(new Registry(packsWith(build, design)));
  await setIslands(l, human, true);
  const { isle } = await make(l, [{ op: 'create', ref: 'isle', type: 'island', title: 'Studio', props: { pack: 'design' } }]);
  await make(l, [{ op: 'create', type: 'design.study', title: 'A study', props: { island: isle } }]);
  return { l, isle } as { l: Archipelago; isle: string };
}

const island = async (l: Archipelago, isle: string) => {
  const answer = (await queryFlatPack.flatRead(kernelContext(l, 'query'), { filter: { find: [`island ${isle}`] } })) as any;
  return answer.islands.find((i: { id: string }) => i.id === isle);
};
const part = (pack: any, id: string) => pack.parts.find((p: { id: string }) => p.id === id);

test('an island speaking Design, which extends Build, with one Build part off: both packs with their parts, states and names', async () => {
  const { l, isle } = await map();
  await make(l, [{ op: 'update', id: isle, props: { parts_off: ['build.overlap'] } }]);
  const got = await island(l, isle);
  assert.deepEqual(got.parts_off, ['build.overlap']);
  const d = got.pack, b = d.requires.find((r: { id: string }) => r.id === 'build');
  assert.equal(d.id, 'design');
  assert.equal(d.state, 'active');
  assert.deepEqual(d.parts, [{ id: 'design.study', kind: 'type', state: 'active', needs: ['build.feature'] }]);
  assert.deepEqual(d.provides, ['type:design.study']);
  assert.deepEqual(d.consumes, [{ name: 'core', by: 'core' }, { name: 'type:build.feature', by: 'build' }]);
  assert.equal(d.lacks, undefined);

  assert.equal(b.state, 'active', 'a part off leaves its pack on');
  assert.deepEqual(part(b, 'build.feature'), { id: 'build.feature', kind: 'type', state: 'active', needs: ['work'] });
  assert.deepEqual(part(b, 'build.overlap'), { id: 'build.overlap', kind: 'type', state: 'off', needs: ['work'] });
  assert.deepEqual(part(b, 'build.touches'), { id: 'build.touches', kind: 'link', state: 'waiting', lacks: ['type:build.overlap'], needs: ['build.overlap', 'build.feature', 'about'] });
  assert.deepEqual(part(b, 'build.watched'), { id: 'build.watched', kind: 'rule', state: 'waiting', lacks: ['type:build.overlap'], needs: ['build.overlap'] });
  assert.deepEqual(b.parts.map((p: { id: string }) => p.id), ['build.feature', 'build.overlap', 'build.touches', 'build.watched'], 'in the manifest’s order, those off kept in place');
  assert.deepEqual(b.provides, ['type:build.feature'], 'what is off or waits gives nothing there');
  assert.deepEqual(b.consumes, [{ name: 'core', by: 'core' }]);
});

test('Build off on the island: Design waits, lacking what Build gave', async () => {
  const { l, isle } = await map();
  await make(l, [{ op: 'update', id: isle, props: { packs_off: ['build'] } }]);
  const got = await island(l, isle);
  const d = got.pack, b = d.requires.find((r: { id: string }) => r.id === 'build');
  assert.equal(got.parts_off, undefined);
  assert.equal(d.state, 'waiting');
  assert.deepEqual(d.lacks, ['type:build.feature']);
  assert.deepEqual(d.consumes, [{ name: 'core', by: 'core' }, { name: 'type:build.feature' }], 'no pack on there gives it');
  assert.deepEqual(d.parts, [{ id: 'design.study', kind: 'type', state: 'waiting', needs: ['build.feature'] }], 'a part of a waiting pack waits with it');
  assert.equal(b.state, 'off');
  assert.ok(b.parts.every((p: { state: string }) => p.state === 'off'), 'and of a pack off, is off');
  assert.equal(b.lacks, undefined, 'a pack off lacks nothing: it is off');
});

test('an island speaking Design holds Build’s types too, and an item of a type turned off there waits saying so', async () => {
  const { l, isle } = await map();
  const { o } = await make(l, [{ op: 'create', ref: 'o', type: 'build.overlap', title: 'Tokens meet layout', props: { island: isle } }]);
  await make(l, [{ op: 'update', id: isle, props: { parts_off: ['build.overlap'] } }]);
  const answer = (await queryFlatPack.flatRead(kernelContext(l, 'query'), { filter: { find: [`island ${isle}`] } })) as any;
  const item = answer.items.find((i: { id: string }) => i.id === o);
  assert.deepEqual(item.waiting, { pack: 'build', why: 'build.overlap is turned off on this island' });
  const study = answer.items.find((i: { type: string }) => i.type === 'design.study');
  assert.equal(study.waiting, undefined, 'what is still on does not wait');
});
