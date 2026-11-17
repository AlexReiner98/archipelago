// An island's own look (packs/loader/kernel/island-look.ts; feature e_6efhubbz, decision e_3c3wr7jv): a layout kept on
// the map about an island rides with that island in every answer that holds it; a style is no look, an archived
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
    { op: 'link', type: 'about', from: 'old', to: isle.here },
    { op: 'link', type: 'about', from: 'style', to: isle.here },
  ]);
  const newer = await make(l, [
    { op: 'create', ref: 'dash', type: 'layout', title: 'Dashboard', props: { code: CODE } },
    { op: 'link', type: 'about', from: 'dash', to: isle.here },
  ]);

  const looks = await islandLooks(l, [isle.here, isle.there]);
  assert.deepEqual({ ...looks.get(isle.here), at: undefined }, { id: newer.dash, kind: 'layout', title: 'Dashboard', at: undefined });
  assert.equal(typeof looks.get(isle.here)?.at, 'string', 'when it last changed, for a page to key its code by');
  assert.equal(looks.has(isle.there), false, 'an island with none has none');

  const answer = (await queryFlatPack.flatRead(kernelContext(l, 'query'), { filter: { find: [`island ${isle.here}`, `island ${isle.there}`] } })) as { islands: { id: string; look?: unknown }[] };
  assert.equal((answer.islands.find((i) => i.id === isle.here)?.look as { id?: string })?.id, newer.dash);
  assert.equal(answer.islands.find((i) => i.id === isle.there)?.look, undefined);

  await make(l, [{ op: 'archive', id: newer.dash }]);
  assert.equal((await islandLooks(l, [isle.here])).get(isle.here)?.id, kept.old, 'archived, the one before draws it');
});
