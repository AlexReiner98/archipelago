// An island's cap (packs/loader/kernel/island-cap.ts; decision e_bgw2u5aw, the owner, 17 Nov 2026): the look says it,
// the map's drawing (canvas's Map, 40) where an island has none, "none" for a look built for big graphs. Core's rule
// island_full refuses an agent's change that puts an island past it; a person's goes through, a split goes through,
// and the islands answer carries each island's count against its cap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capOf, islandCaps, mapCap } from '../packs/loader/kernel/island-cap.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import * as queryFlatPack from '../packs/query/kernel/query-flat.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';
import type { Op } from '../packs/write/kernel/pelago-types.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

const CODE = 'export default () => ({ scene: [] });';

test('a cap is a whole number or none', () => {
  assert.equal(capOf(40), 40);
  assert.equal(capOf('none'), null);
  for (const no of [0, -3, 2.5, '40', undefined, null]) assert.equal(capOf(no), undefined, String(no));
});

test('an island takes its look’s cap, else the map’s; an agent past it is refused, a person and a split are not', async () => {
  const l = await freshWith(new Registry(packsWith()), { create: 'auto', update: 'auto', link: 'auto' });
  await setIslands(l, human, true);
  assert.equal(await mapCap(l.db, l.registry), 40, 'canvas’s Map ships 40');
  const isle = await make(l, [
    { op: 'create', ref: 'small', type: 'island', title: 'Small', props: { pack: 'core' } },
    { op: 'create', ref: 'big', type: 'island', title: 'Big', props: { pack: 'core' } },
    { op: 'create', ref: 'plain', type: 'island', title: 'Plain', props: { pack: 'core' } },
  ]);
  await make(l, [
    { op: 'create', ref: 'two', type: 'layout', title: 'Two at most', props: { code: CODE, cap: 2 } },
    { op: 'create', ref: 'all', type: 'layout', title: 'Particles', props: { code: CODE, cap: 'none' } },
    { op: 'link', type: 'draws', from: 'two', to: isle.small },
    { op: 'link', type: 'draws', from: 'all', to: isle.big },
  ]);
  const caps = await islandCaps(l.db, l.registry, [isle.small, isle.big, isle.plain]);
  assert.deepEqual([caps.get(isle.small), caps.get(isle.big), caps.get(isle.plain)], [2, null, 40]);

  const by = async (ops: Op[], who = agent) => (await l.change(who, { ops, reason: 'the test' }).catch((e: Error) => ({ status: 'refused', error: e.message }))) as { status: string; created?: Record<string, string>; error?: string };
  const tasks = (island: string, n: number, from = 0): Op[] => Array.from({ length: n }, (_, k) => ({ op: 'create', ref: `t${from + k}`, type: 'task', title: `Task ${from + k}`, props: { island } }) as Op);

  const two = await by(tasks(isle.small, 2));
  assert.equal(two.status, 'applied', JSON.stringify(two));
  const third = await by(tasks(isle.small, 1, 2));
  assert.notEqual(third.status, 'applied');
  assert.match(third.error ?? "", /"Small" would hold 3 items, past its cap of 2/);
  assert.equal((await by(tasks(isle.small, 1, 3), human)).status, 'applied', 'a person’s change goes through');
  assert.equal((await by(tasks(isle.big, 5, 10))).status, 'applied', 'a look with no cap holds any number');

  // A split: two of Small's move to an island made in the same change; Small shrinks, nothing grows past a cap.
  const [a, b] = Object.values(two.created!);
  const split = await by([
    { op: 'create', ref: 'part', type: 'island', title: 'Small, part two', props: { pack: 'core' } },
    { op: 'update', id: a, props: { island: '{part}' } },
    { op: 'update', id: b, props: { island: '{part}' } },
  ] as Op[]);
  assert.equal(split.status, 'applied', JSON.stringify(split));

  const answer = (await queryFlatPack.flatRead(kernelContext(l, 'query'), { filter: { find: [`island ${isle.small}`, `island ${isle.big}`] } })) as { islands: { id: string; cap?: unknown }[] };
  assert.deepEqual(answer.islands.find((i) => i.id === isle.small)?.cap, { count: 1, most: 2 });
  assert.deepEqual(answer.islands.find((i) => i.id === isle.big)?.cap, { count: 5, most: null });
});
