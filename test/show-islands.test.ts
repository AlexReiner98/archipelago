// A show of islands puts them on the person's canvas at once (the owner, 18 Nov 2026, bump e_wpybzm42): they join the
// list on the person's item through the one write path, so they are there whenever the person next looks, a page open
// or not (packs/surface/kernel/show-islands.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shownIslands, withIslands } from '../packs/surface/kernel/show-islands.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, fresh, human } from './map.ts';

test('the islands a show names are those of its address and its item’s own, each once', () => {
  assert.deepEqual(shownIslands('v?islands=e_aaaaaaaa,frontier,e_bbbbbbbb', 'e_aaaaaaaa'), ['e_aaaaaaaa', 'e_bbbbbbbb'], 'a live read is no island');
  assert.deepEqual(shownIslands('e/e_cccccccc', 'e_dddddddd'), ['e_dddddddd']);
  assert.deepEqual(shownIslands('e/e_cccccccc'), []);
  assert.deepEqual(withIslands(['e_aaaaaaaa', 'frontier'], ['e_aaaaaaaa', 'e_bbbbbbbb']), ['e_aaaaaaaa', 'frontier', 'e_bbbbbbbb'], 'after what was there, in order');
  assert.equal(withIslands(['e_aaaaaaaa'], ['e_aaaaaaaa']), null, 'nothing new, no change');
});

test('a show puts the islands it names on the person’s own list, with no page open', async () => {
  const l = await fresh();
  const me = ((await callTool(l, human, 'init', { name: 'Alex' })) as { me: string }).me;
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  const made = (await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'harbour', type: 'island', title: 'Harbour works' },
      { op: 'create', ref: 'quarry', type: 'island', title: 'Quarry' },
      { op: 'update', id: me, props: { islands: ['frontier'] } },
    ],
  }) as { created: Record<string, string> }).created;
  const islands = async () => (await l.entity(me))?.props.islands;

  const shown = (await callTool(l, agent, 'show', { islands: [made.harbour] })) as { put_on?: string[] };
  assert.deepEqual(shown.put_on, [made.harbour], 'the answer says what it put on');
  assert.deepEqual(await islands(), ['frontier', made.harbour], 'kept on the person, after what they had');

  // Two at once, one on already: the new one goes on; shown again, nothing changes. (An item's own island is the
  // island shownIslands is given: the first test.)
  await callTool(l, agent, 'show', { islands: [made.harbour, made.quarry] });
  assert.deepEqual(await islands(), ['frontier', made.harbour, made.quarry]);
  const again = (await callTool(l, agent, 'show', { islands: [made.quarry] })) as { put_on?: string[] };
  assert.equal(again.put_on, undefined, 'already on: nothing put on');

  // A person who has never chosen sees the map's islands already: their list is left unmade.
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: me, props: { islands: null } }] });
  await callTool(l, agent, 'show', { islands: [made.harbour] });
  assert.equal(await islands(), undefined);
});
