// What changes held for the owner add to a picture, the write pack's part (packs/write/parts/ghosts): a new item where
// its links reach what is drawn, a link between what is drawn, an edit marked on its item, and nothing that would land
// nowhere in sight. The part decides; the runtime draws each ghost.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { ghostsOf } from '../packs/write/parts/ghosts/ghosts.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import ghosts from '../packs/write/parts/ghosts/index.js';

const drawn = ['e_aaaaaaaa', 'e_bbbbbbbb'];
const holds = (id: string) => drawn.includes(id);
const held = [
  { id: 'p_link', actor: 'robot', reason: 'a link', ops: [{ op: 'link', type: 'depends_on', from: 'e_aaaaaaaa', to: 'e_bbbbbbbb' }] },
  // A new item tied to what is drawn through another new item: both land, and both links.
  { id: 'p_make', ops: [{ op: 'create', ref: 'x', type: 'task', title: 'X' }, { op: 'create', ref: 'y', type: 'task', title: 'Y' }, { op: 'link', type: 'part_of', from: 'x', to: 'y' }, { op: 'link', type: 'part_of', from: 'y', to: 'e_aaaaaaaa' }] },
  // Tied to nothing drawn: nothing.
  { id: 'p_away', ops: [{ op: 'create', ref: 'z', type: 'task', title: 'Z' }, { op: 'link', type: 'part_of', from: 'z', to: 'e_zzzzzzzz' }] },
  { id: 'p_edit', ops: [{ op: 'update', id: 'e_bbbbbbbb', title: 'B2' }, { op: 'update', id: 'e_zzzzzzzz', title: 'gone' }] },
];

test('held changes are drawn where they would land, and only there', () => {
  const g = ghostsOf(held, holds);
  assert.deepEqual(g.items.map((i: { id: string }) => i.id), ['p_make:x', 'p_make:y']);
  assert.deepEqual(g.items[0].pending, { proposal: 'p_make', op: 'create' });
  assert.equal(g.items[0].type, 'task');
  assert.deepEqual(g.links.map((l: { from: string; to: string }) => `${l.from}>${l.to}`), ['e_aaaaaaaa>e_bbbbbbbb', 'p_make:x>p_make:y', 'p_make:y>e_aaaaaaaa']);
  assert.deepEqual(g.links[0].pending, { proposal: 'p_link', by: 'robot', reason: 'a link', op: 'link' });
  assert.deepEqual([...g.marks.keys()], ['e_bbbbbbbb']);
  assert.deepEqual(ghostsOf(held, holds, true).items.map((i: { id: string }) => i.id), ['p_make:x', 'p_make:y', 'p_away:z'], 'on a canvas of what is held, every new item');
});

test('the part answers with a ghost for each, as the runtime reads them back', () => {
  const part = ghosts({ held, drawn });
  const [list, at, ...marks] = part.marks;
  assert.equal(list, 'list');
  assert.deepEqual(at, {});
  assert.deepEqual(marks.map(([kind, a]: [string, { of: string; id?: string; on?: string }]) => `${kind} ${a.of} ${a.id ?? a.on}`), ['ghost item p_make:x', 'ghost item p_make:y', 'ghost link p_link:0', 'ghost link p_make:2', 'ghost link p_make:3', 'ghost mark e_bbbbbbbb']);
  assert.deepEqual(marks[2][1], { of: 'link', id: 'p_link:0', type: 'depends_on', from: 'e_aaaaaaaa', to: 'e_bbbbbbbb', proposal: 'p_link', by: 'robot', reason: 'a link', op: 'link' });
  assert.deepEqual(marks.at(-1)[1], { of: 'mark', on: 'e_bbbbbbbb', proposal: 'p_edit', op: 'update' });
  assert.deepEqual(part.update({ held: [], drawn }), ['list', {}], 'nothing held, nothing drawn');
  assert.deepEqual(ghosts({}).marks, ['list', {}]);
});

test('the runtime draws the ghosts into an answer, with the links drawn here and not yet answered for', async () => {
  // @ts-expect-error a page module, plain JavaScript: what the runtime keeps until it reads the part's ghost marks
  const { HELD, withGhosts } = await import('../ui/ghosts.js');
  const g = ghostsOf(held, holds);
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
