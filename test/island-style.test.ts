// Each island styled by the packs active on it (packs/loader/kernel/island-style.ts; decisions e_gqmavsb7 and
// e_gg25e3kf): a preset on a pack's types reaches the islands that speak that pack and no other, the owner's version of
// it lies over it, a retired one is not used, and turning either pack off on an island drops it there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { islandStyles } from '../packs/loader/kernel/island-style.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import * as queryFlatPack from '../packs/query/kernel/query-flat.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';
import { freshWith, human, make, packsWith } from './map.ts';

/** An island pack, words only, and a map pack that gives its type a look. */
const plain = { id: 'plain', version: '1.0.0', title: 'Plain', description: 'Words.', requires: ['core'], types: [{ id: 'plain.thing', title: 'Thing', description: 'A thing.', extends: 'work' }] };
const looks = {
  id: 'plainlook', version: '1.0.0', title: 'Plain look', description: 'How plain things look.', requires: ['core'],
  styles: [{ id: 'plainlook.things', title: 'Things', on: ['plain.thing'], props: { type_shapes: { 'plain.thing': 'diamond' }, phase_marks: { under_way: 'full' } } }],
};

test('a preset on a pack’s types styles its islands alone, under the owner’s version, and a pack off there drops it', async () => {
  const l = await freshWith(new Registry(packsWith(plain, looks)));
  await setIslands(l, human, true);
  const isle = await make(l, [
    { op: 'create', ref: 'here', type: 'island', title: 'Here', props: { pack: 'plain' } },
    { op: 'create', ref: 'core', type: 'island', title: 'Core', props: { pack: 'core' } },
  ]);
  await make(l, [{ op: 'create', type: 'plain.thing', title: 'A thing', props: { island: isle.here } }, { op: 'create', type: 'task', title: 'A task', props: { island: isle.core } }]);
  const both = [{ id: isle.here, pack: 'plain' }, { id: isle.core, pack: 'core' }];

  let styles = await islandStyles(l, both);
  assert.deepEqual(styles.get(isle.here)?.type_shapes, { 'plain.thing': 'diamond' });
  assert.equal(styles.has(isle.core), false, 'an island of another pack takes none of it');

  const answer = (await queryFlatPack.flatRead(kernelContext(l, 'query'), { filter: { find: [`island ${isle.here}`] } })) as { islands: { id: string; style?: Record<string, unknown> }[] };
  assert.deepEqual(answer.islands.find((i) => i.id === isle.here)?.style?.phase_marks, { under_way: 'full' }, 'the answer carries it');

  const kept = await make(l, [{ op: 'create', ref: 'v', type: 'style', title: 'My things', props: { preset: 'plainlook.things', type_shapes: { 'plain.thing': 'pill' } } }]);
  styles = await islandStyles(l, both);
  assert.deepEqual(styles.get(isle.here)?.type_shapes, { 'plain.thing': 'pill' }, 'the owner’s version lies over it');

  await make(l, [{ op: 'update', id: kept.v, status: 'retired' }]);
  assert.equal((await islandStyles(l, both)).has(isle.here), false, 'retired, the preset is not used');
  await make(l, [{ op: 'update', id: kept.v, status: 'current' }]);

  const mineOn = await make(l, [{ op: 'create', ref: 's', type: 'style', title: 'Things as flags', props: { on: ['plain.thing'], type_shapes: { 'plain.thing': 'flag' } } }]);
  assert.deepEqual((await islandStyles(l, both)).get(isle.here)?.type_shapes, { 'plain.thing': 'flag' }, 'a style a person keeps on the type lies nearest');
  await make(l, [{ op: 'archive', id: mineOn.s }]);

  await make(l, [{ op: 'update', id: isle.here, props: { packs_off: ['plainlook'] } }]);
  assert.equal((await islandStyles(l, both)).has(isle.here), false, 'the look’s pack off on the island drops it there');
  await make(l, [{ op: 'update', id: isle.here, props: { packs_off: ['plain'] } }]);
  assert.equal((await islandStyles(l, both)).has(isle.here), false, 'and so does the island’s own pack off');
});
