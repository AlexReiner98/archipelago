// How a page looks is its style (the style view): the presets the packs ship, under what the map keeps. A document
// reads through with no picture, because the work pack's preset on documents says so; anything else has the house
// style's page; and the owner's version of a preset changes it for every such item.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VIEWS } from '../src/views.ts';
import { fresh, make } from './map.ts';

test('a page is drawn by its style: the house style, a kind\'s preset over it, the owner\'s version over that', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'P' },
    { op: 'create', ref: 'd', type: 'work.document', title: 'D' },
  ]);
  const of = async (id?: string) => (await VIEWS.style.run(l, id ? { of: id } : {})) as { style: any; used: { id: string; preset?: string }[] };
  const workspace = await of();
  assert.deepEqual([workspace.style.page.picture, workspace.style.page.notes, typeof workspace.style.numbers.note_opening_most], [true, 'folded', 'number']);
  const project = await of(made.p);
  assert.deepEqual([project.style.page.picture, project.style.page.notes], [true, 'folded'], 'a project has the house style');
  const doc = await of(made.d);
  assert.deepEqual([doc.style.page.picture, doc.style.page.notes, doc.style.page.ties], [false, 'whole', 'open'], 'a document reads through, the rest of its page the house style\'s');
  assert.deepEqual(doc.used.map((u) => u.preset), ['core.house', 'work.reading']);
  // The owner's version of the reading preset: documents fold again, the picture still left out.
  await make(l, [{ op: 'create', ref: 'v', type: 'style', title: 'Mine', props: { preset: 'work.reading', page: { notes: 'folded' } } }]);
  const mine = await of(made.d);
  assert.deepEqual([mine.style.page.picture, mine.style.page.notes], [false, 'folded']);
  await assert.rejects(of('e_nothing0'), /No entity/);
});
