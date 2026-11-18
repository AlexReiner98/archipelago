// A pack extends another by the type names it requires (packs/loader/kernel/islands.ts, decision e_rdfvhra7, task
// e_aht3e5x7): on an island map, Design requiring `type:build.feature` may declare a type extending it, and waits with
// what it lacks while Build is off (packs/loader/kernel/packorder.ts, task e_puhgbg9u). Naming a Build type it does not
// require is still refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../packs/identity/kernel/workspaces.ts'; // as on a server: a change to a pack item makes the packs on follow
import { setIslands, setPack } from '../packs/loader/kernel/packstate.ts';
import { fresh, human, make } from './map.ts';

const BUILD = {
  requires: ['core'],
  types: [
    { id: 'build.feature', title: 'Feature', description: 'What is built.', extends: 'work' },
    { id: 'build.lane', title: 'Lane', description: 'One session’s part of a feature.', extends: 'work' },
  ],
  links: [{ id: 'build.lane_of', title: 'Lane of', inverse: 'Has lane', extends: 'about', from: ['build.lane'], to: ['build.feature'], description: 'A lane of a feature.' }],
};
const DESIGN = {
  requires: ['core', 'type:build.feature', 'type:build.lane', 'type:build.lane_of'],
  types: [{ id: 'design.study', title: 'Study', description: 'A design study.', extends: 'build.feature' }],
  links: [{ id: 'design.studies', title: 'Studies', inverse: 'Studied in', extends: 'build.lane_of', from: ['build.lane'], to: ['design.study'], description: 'A lane studies it.' }],
  rules: [{ id: 'design.hold', when: { actor: 'agent', type: 'build.lane' }, then: 'hold', say: 'Lanes of a study are the owner’s.' }],
};
const pack = (ref: string, name: string, manifest: Record<string, unknown>) => ({ op: 'create', ref, type: 'pack', title: name, body: `The ${name} pack.`, props: { name, manifest } }) as const;

async function islandMap() {
  const l = await fresh();
  await setIslands(l, human, true);
  await make(l, [pack('b', 'build', BUILD)]);
  await setPack(l, human, { pack: 'build', on: true });
  return l;
}

test('a pack requiring another’s types by name extends them on an island map', async () => {
  const l = await islandMap();
  const { d } = await make(l, [pack('d', 'design', DESIGN)]);
  assert.ok(d);
  await setPack(l, human, { pack: 'design', on: true });
  assert.equal(l.registry.states.get('build')?.state, 'active');
  assert.equal(l.registry.states.get('design')?.state, 'active', 'it names build’s types only as it requires them');
  assert.deepEqual(l.registry.type('design.study')?.lineage.slice(0, 2), ['design.study', 'build.feature']);
  assert.ok(l.registry.relations.has('design.studies'));
});

test('with the pack it extends off, it waits, lacking each name it requires', async () => {
  const l = await islandMap();
  await make(l, [pack('d', 'design', DESIGN)]);
  await setPack(l, human, { pack: 'design', on: true });
  await setPack(l, human, { pack: 'build', on: false });
  const design = l.registry.states.get('design');
  assert.equal(design?.state, 'waiting');
  assert.deepEqual(design?.lacks, ['type:build.feature', 'type:build.lane', 'type:build.lane_of'], 'every name, not only the first');
  for (const n of design!.lacks!) assert.ok(design!.why!.includes(n), `why names ${n}`);
  assert.ok(!l.registry.types.has('design.study') || l.registry.type('design.study')?.dormant, 'a waiting pack registers nothing: its type is dormant');
  await setPack(l, human, { pack: 'build', on: true });
  assert.equal(l.registry.states.get('design')?.state, 'active', 'back on, it loads');
  assert.equal(l.registry.states.get('design')?.lacks, undefined);
});

test('naming another pack’s type it does not require is still refused', async () => {
  const l = await islandMap();
  const bare = { ...DESIGN, requires: ['core', 'type:build.lane', 'type:build.lane_of'] };
  await assert.rejects(make(l, [pack('d', 'design', bare)]), /not taken on an island map: it names build\.feature, not its own, in the shared set .* nor required by name/);
  const unlinked = { ...DESIGN, requires: ['core', 'type:build.feature', 'type:build.lane'] };
  await assert.rejects(make(l, [pack('d', 'design', unlinked)]), /its links extend another pack's \(design\.studies extends build\.lane_of\)/);
  const shaped = { ...DESIGN, requires: [...DESIGN.requires, 'field:due@build.task'] };
  await assert.rejects(make(l, [pack('d', 'design', shaped)]), /names build\.task/, 'a shaped name is not relaxed');
});
