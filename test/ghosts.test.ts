// What changes held for the owner add to a picture, the write pack's part (packs/write/parts/ghosts): a new item where
// its links reach what is drawn, a link between what is drawn, an edit marked on its item, and nothing that would land
// nowhere in sight. The part decides; the runtime (packs/surface/page/replica.js) checks the ghosts and draws them in.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { uiFile } from '../packs/surface/kernel/ui-files.ts';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { ghostsOf } from '../packs/write/parts/ghosts/ghosts.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import ghosts, { ghostList } from '../packs/write/parts/ghosts/index.js';

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

test('the part decides the ghosts as data, and draws nothing', async () => {
  const part = ghosts();
  assert.equal(part.marks, undefined, 'no marks: it is only asked');
  const list = await part.decide({ held, drawn });
  assert.deepEqual(list.map((g: { of: string; id?: string; on?: string }) => `${g.of} ${g.id ?? g.on}`),['item p_make:x', 'item p_make:y', 'link p_link:0', 'link p_make:2', 'link p_make:3', 'mark e_bbbbbbbb']);
  assert.deepEqual(list[2], { of: 'link', id: 'p_link:0', type: 'depends_on', from: 'e_aaaaaaaa', to: 'e_bbbbbbbb', proposal: 'p_link', by: 'robot', reason: 'a link', op: 'link' });
  assert.deepEqual(list.at(-1), { of: 'mark', on: 'e_bbbbbbbb', proposal: 'p_edit', op: 'update' });
  assert.deepEqual(ghostList({}), [], 'nothing held, nothing drawn');
});

/** The replica as the server serves it, loaded from a folder of its own as the browser would load it. */
async function replica() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-ghosts-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['project.js', 'membership.js', 'replica.js']) writeFileSync(join(dir, f), (await uiFile(f, null)).body as string);
  return import(pathToFileURL(join(dir, 'replica.js')).href);
}

test('the runtime checks what the part answered and draws it into the answer, with the links drawn here', async () => {
  const { ghostsFrom, withGhosts } = await replica();
  const g = ghostsFrom([
    ...ghostList({ held, drawn }),
    // Not of a held change, another's id, an op that is not its kind's: each left out.
    { of: 'item', id: 'e_cccccccc', type: 'task', title: 'C', proposal: 'p_make', op: 'create' },
    { of: 'link', id: 'p_other:1', type: 'part_of', from: 'e_aaaaaaaa', to: 'e_bbbbbbbb', proposal: 'p_make', op: 'link' },
    { of: 'mark', on: 'e_aaaaaaaa', proposal: 'p_edit', op: 'create' },
    { of: 'item', id: 'nope:1', type: 'task', title: 'N', proposal: 'nope', op: 'create' },
  ]);
  assert.deepEqual(g.items.map((i: { id: string }) => i.id), ['p_make:x', 'p_make:y']);
  assert.deepEqual(g.items[0].pending, { proposal: 'p_make', op: 'create' });
  assert.deepEqual(g.links.map((l: { id: string }) => l.id), ['p_link:0', 'p_make:2', 'p_make:3']);
  assert.deepEqual([...g.marks.keys()], ['e_bbbbbbbb']);
  assert.deepEqual(ghostsFrom('not a list'), { items: [], links: [], marks: new Map() });
  const answer = { items: [{ id: 'e_aaaaaaaa' }, { id: 'e_bbbbbbbb' }], links: [] };
  const shown = withGhosts(answer, g, [{ id: 'mine:1', type: 'depends_on', from: 'e_bbbbbbbb', to: 'e_aaaaaaaa' }, { id: 'mine:2', type: 'depends_on', from: 'e_bbbbbbbb', to: 'e_cccccccc' }]);
  assert.equal(shown.items.length, 4);
  assert.deepEqual(shown.items[1].pending, { proposal: 'p_edit', op: 'update' });
  assert.deepEqual(shown.links.at(-1).pending, { mine: true, op: 'link' }, 'a link drawn here, pending');
  assert.equal(shown.links.length, 4, 'one drawn here to what is not drawn is left out');
  assert.equal(answer.items.length, 2, 'the answer itself is left as it was');
  // A ghost link to what is no longer drawn (an answer from before the canvas moved) is not drawn.
  assert.deepEqual(withGhosts({ items: [{ id: 'e_aaaaaaaa' }], links: [] }, g).links.map((l: { id: string }) => l.id), ['p_make:2', 'p_make:3']);
});
