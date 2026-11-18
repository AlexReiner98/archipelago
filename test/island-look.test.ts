// An island's own look (packs/loader/kernel/island-look.ts; feature e_6efhubbz, decisions e_3c3wr7jv, e_gwfwbx3t): a
// layout that draws an island (core's link draws) rides with that island in every answer that holds it; a style is no look, an archived
// layout none, and of several the one changed last draws it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { islandLooks } from '../packs/loader/kernel/island-look.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import * as queryFlatPack from '../packs/query/kernel/query-flat.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';
import { freshWith, human, make, packsWith } from './map.ts';

const CODE = 'export default () => ({ scene: [] });';

test('a layout kept about an island is its look in the answer; a style is none, nor one archived, and the last changed wins', async () => {
  const l = await freshWith(new Registry(packsWith()));
  await setIslands(l, human, true);
  const isle = await make(l, [
    { op: 'create', ref: 'here', type: 'island', title: 'Here', props: { pack: 'core' } },
    { op: 'create', ref: 'there', type: 'island', title: 'There', props: { pack: 'core' } },
  ]);
  const items = await make(l, [
    { op: 'create', ref: 'a', type: 'task', title: 'On here', props: { island: isle.here } },
    { op: 'create', ref: 'b', type: 'task', title: 'On there', props: { island: isle.there } },
  ]);
  assert.ok(items.a && items.b);
  const kept = await make(l, [
    { op: 'create', ref: 'old', type: 'layout', title: 'Older dashboard', props: { code: CODE } },
    { op: 'create', ref: 'style', type: 'style', title: 'A style is no look', props: {} },
    { op: 'link', type: 'draws', from: 'old', to: isle.here },
    { op: 'link', type: 'about', from: 'style', to: isle.here },
    { op: 'create', ref: 'aboutOnly', type: 'layout', title: 'Kept for its pictures', props: { code: CODE } },
    { op: 'link', type: 'about', from: 'aboutOnly', to: isle.there },
  ]);
  const newer = await make(l, [
    { op: 'create', ref: 'dash', type: 'layout', title: 'Dashboard', props: { code: CODE } },
    { op: 'link', type: 'draws', from: 'dash', to: isle.here },
  ]);

  const looks = await islandLooks(l, [isle.here, isle.there]);
  assert.deepEqual({ ...looks.get(isle.here), at: undefined }, { id: newer.dash, kind: 'layout', title: 'Dashboard', at: undefined, coded: true });
  assert.equal(typeof looks.get(isle.here)?.at, 'string', 'when it last changed, for a page to key its code by');
  assert.equal(looks.has(isle.there), false, 'an island with none has none: a layout about it is kept for its pictures, no look');

  const answer = (await queryFlatPack.flatRead(kernelContext(l, 'query'), { filter: { find: [`island ${isle.here}`, `island ${isle.there}`] } })) as { islands: { id: string; look?: unknown }[] };
  assert.equal((answer.islands.find((i) => i.id === isle.here)?.look as { id?: string })?.id, newer.dash);
  assert.equal(answer.islands.find((i) => i.id === isle.there)?.look, undefined);

  assert.equal(looks.get(isle.here)?.coded, true);
  const capOnly = await make(l, [{ op: 'create', ref: 'c', type: 'layout', title: 'A cap alone', props: {} }, { op: 'link', type: 'draws', from: 'c', to: isle.there }]);
  assert.equal((await islandLooks(l, [isle.there])).get(isle.there)?.coded, false, 'a look with no code says so, and its island is drawn as any other');
  assert.ok(capOnly.c);

  await make(l, [{ op: 'archive', id: newer.dash }]);
  assert.equal((await islandLooks(l, [isle.here])).get(isle.here)?.id, kept.old, 'archived, the one before draws it');
});

test('where nothing draws an island, a style on its type names its look; a link of its own still wins, and a retired style names none', async () => {
  const l = await freshWith(new Registry(packsWith()));
  const isle = await make(l, [
    { op: 'create', ref: 'feature', type: 'task', title: 'A focus of a type the style is on' },
    { op: 'create', ref: 'linked', type: 'task', title: 'A focus drawn by its own link' },
    { op: 'create', ref: 'other', type: 'person', title: 'A focus of another type' },
  ]);
  const kept = await make(l, [
    { op: 'create', ref: 'lines', type: 'layout', title: 'Lines', props: { code: CODE } },
    { op: 'create', ref: 'own', type: 'layout', title: 'Its own', props: { code: CODE } },
    { op: 'link', type: 'draws', from: 'own', to: isle.linked },
  ]);
  Object.assign(kept, await make(l, [{ op: 'create', ref: 'style', type: 'style', title: 'Work is drawn as lines', props: { on: ['work'], look: kept.lines } }]));

  const looks = await islandLooks(l, [isle.feature, isle.linked, isle.other]);
  assert.equal(looks.get(isle.feature)?.id, kept.lines, 'a task is work: the style names its look');
  assert.equal(looks.get(isle.feature)?.coded, true);
  assert.equal(looks.get(isle.linked)?.id, kept.own, 'a draws link of its own wins over the style');
  assert.equal(looks.has(isle.other), false, 'a person is not work: no look');

  await make(l, [{ op: 'update', id: kept.style, status: 'retired' }]);
  assert.equal((await islandLooks(l, [isle.feature])).has(isle.feature), false, 'a retired style names no look');
});
