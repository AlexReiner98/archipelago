// What changes held for the owner add to a picture (ui/ghosts.js): a new item where its links reach what is drawn, a
// link between what is drawn, an edit marked on its item, and nothing that would land nowhere in sight.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a page module, plain JavaScript
import { ghostsOf, HELD, withGhosts } from '../ui/ghosts.js';

const drawn = new Set(['e_aaaaaaaa', 'e_bbbbbbbb']);
const holds = (id: string) => drawn.has(id);

test('held changes are drawn where they would land, and only there', () => {
  const g = ghostsOf(
    [
      { id: 'p_link', actor: 'robot', reason: 'a link', ops: [{ op: 'link', type: 'depends_on', from: 'e_aaaaaaaa', to: 'e_bbbbbbbb' }] },
      // A new item tied to what is drawn through another new item: both land, and both links.
      { id: 'p_make', ops: [{ op: 'create', ref: 'x', type: 'work.task', title: 'X' }, { op: 'create', ref: 'y', type: 'work.task', title: 'Y' }, { op: 'link', type: 'part_of', from: 'x', to: 'y' }, { op: 'link', type: 'part_of', from: 'y', to: 'e_aaaaaaaa' }] },
      // Tied to nothing drawn: nothing.
      { id: 'p_away', ops: [{ op: 'create', ref: 'z', type: 'work.task', title: 'Z' }, { op: 'link', type: 'part_of', from: 'z', to: 'e_zzzzzzzz' }] },
      { id: 'p_edit', ops: [{ op: 'update', id: 'e_bbbbbbbb', title: 'B2' }, { op: 'update', id: 'e_zzzzzzzz', title: 'gone' }] },
    ],
    holds,
    () => 'work',
  );
  assert.deepEqual(g.items.map((i: { id: string }) => i.id), ['p_make:x', 'p_make:y']);
  assert.deepEqual(g.items[0].pending, { proposal: 'p_make', op: 'create' });
  assert.equal(g.items[0].kind, 'work');
  assert.deepEqual(g.links.map((l: { from: string; to: string }) => `${l.from}>${l.to}`), ['e_aaaaaaaa>e_bbbbbbbb', 'p_make:x>p_make:y', 'p_make:y>e_aaaaaaaa']);
  assert.deepEqual(g.links[0].pending, { proposal: 'p_link', by: 'robot', reason: 'a link', op: 'link' });
  assert.deepEqual([...g.marks.keys()], ['e_bbbbbbbb']);

  const answer = { items: [{ id: 'e_aaaaaaaa' }, { id: 'e_bbbbbbbb' }], links: [] };
  const shown = withGhosts(answer, g, [{ id: 'mine:1', type: 'depends_on', from: 'e_bbbbbbbb', to: 'e_aaaaaaaa' }, { id: 'mine:2', type: 'depends_on', from: 'e_bbbbbbbb', to: 'e_cccccccc' }]);
  assert.equal(shown.items.length, 4);
  assert.deepEqual(shown.items[1].pending, { proposal: 'p_edit', op: 'update' });
  assert.deepEqual(shown.links.at(-1).pending, { mine: true, op: 'link' }, 'a link drawn here, pending');
  assert.equal(shown.links.length, 4, 'one drawn here to what is not drawn is left out');
  assert.equal(answer.items.length, 2, 'the answer itself is left as it was');
  assert.equal(HELD.exec('held:p_abc123:4')?.[1], 'p_abc123');
  assert.equal(HELD.exec('s:held:p_abc'), null);
});
