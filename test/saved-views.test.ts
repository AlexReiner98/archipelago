// Saved views: every picture kept on the map, named by the style that draws it, with what it is of, the kept first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry, type PackFile } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';
import { fresh, freshWith, human, make, packsWith } from './map.ts';

/** A pack whose one type sits at the altitude of a project, as a pack that keeps projects declares it. */
const projects: PackFile = { id: 'x', version: '1', title: 'X', requires: ['core'], types: [{ id: 'x.project', title: 'Project', description: 'A project.', extends: 'work', altitude: 'project' }] };

test('saved views name each kept picture by its own title, say what it is of, put the kept first, and names the project it is in', async () => {
  const l = await freshWith(new Registry(packsWith(projects)));
  const made = await make(l, [
    { op: 'create', ref: 'proj', type: 'x.project', title: 'Archipelago', status: 'doing' },
    { op: 'create', ref: 'stream', type: 'task', title: 'A sovereign stack', status: 'todo' },
    { op: 'create', ref: 'stack', type: 'place', title: 'Sovereign AI stack', status: 'available' },
    { op: 'link', type: 'part_of', from: 'stream', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'stack', to: 'stream' },
    { op: 'create', ref: 'wired', type: 'lens', title: 'The stack as wired', props: { filter: { find: ['type place'] } } },
    { op: 'create', ref: 'arch', type: 'style', title: 'The stack as a map', status: 'current', props: { shape: 'map' } },
    { op: 'link', type: 'about', from: 'wired', to: 'stack' },
    { op: 'link', type: 'about', from: 'arch', to: 'wired' },
    { op: 'create', ref: 'board', type: 'lens', title: 'Kanban board', status: 'kept', props: { filter: { find: ['type task'] } } },
  ]);
  const { pictures, more } = (await callTool(l, human, 'view', { name: 'saved_views', params: {} })) as { pictures: Record<string, unknown>[]; more: number };
  assert.deepEqual(pictures, [
    { lens: made.board, title: 'Kanban board', life: 'kept' },
    { lens: made.wired, title: 'The stack as wired', shape: 'map', of: { id: made.stack, title: 'Sovereign AI stack', type: 'place' }, project: { id: made.proj, title: 'Archipelago' }, life: 'working' },
  ]);
  assert.equal(more, 0);
  const one = (await callTool(l, human, 'view', { name: 'saved_views', params: { limit: 1 } })) as { pictures: unknown[]; more: number };
  assert.deepEqual([one.pictures.length, one.more], [1, 1]);
});

test('a view a document brings in says which document, and an archived document no longer holds it', async () => {
  const l = await fresh();
  const { view, loose } = await make(l, [
    { op: 'create', ref: 'view', type: 'lens', title: 'In a page', props: { filter: { find: ['type task'] } } },
    { op: 'create', ref: 'loose', type: 'lens', title: 'On its own', props: { filter: { find: ['type task'] } } },
  ]);
  const { doc } = await make(l, [{ op: 'create', ref: 'doc', type: 'shared_document', title: 'A page', body: `Words.\n\n${view}\n\nMore words.` }]);
  const read = async () => ((await callTool(l, human, 'view', { name: 'saved_views', params: {} })) as { pictures: { lens: string; document?: { id: string; title: string } }[] }).pictures;
  const pictures = await read();
  assert.deepEqual(pictures.find((p) => p.lens === view)?.document, { id: doc, title: 'A page' });
  assert.equal(pictures.find((p) => p.lens === loose)?.document, undefined);
  await l.change(human, { reason: 'test', ops: [{ op: 'archive', id: doc }] });
  assert.equal((await read()).find((p) => p.lens === view)?.document, undefined);
});

test('a saved view is named by its own title and shaped by the style it names itself, over one kept about it', async () => {
  const l = await fresh();
  const { grid } = await make(l, [{ op: 'create', ref: 'grid', type: 'style', title: 'The grid', props: { open: 2 } }]);
  const made = await make(l, [
    { op: 'create', ref: 'about', type: 'style', title: 'Its old style', props: { shape: 'map' } },
    { op: 'create', ref: 'v', type: 'lens', title: 'Work', props: { filter: { find: ['type task'] }, style: { style: grid } } },
    { op: 'link', type: 'about', from: 'about', to: 'v' },
    { op: 'create', ref: 'w', type: 'lens', title: 'Flow of work', props: { filter: { find: ['type task'] }, style: { shape: 'map' } } },
  ]);
  const { pictures } = (await callTool(l, human, 'view', { name: 'saved_views', params: {} })) as { pictures: Record<string, unknown>[] };
  assert.deepEqual(new Map(pictures.map((p) => [p.lens, [p.title, p.shape]])), new Map([[made.v, ['Work', undefined]], [made.w, ['Flow of work', 'map']]]), 'the style it names says no shape, and the one about it is not read');
});

test('a view that cannot draw here says why: a type the map lacks, a layout that is not on it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'ok', type: 'lens', title: 'Draws', props: { filter: { find: ['type task'] } } },
    { op: 'create', ref: 'odd', type: 'lens', title: 'A gone type', props: { filter: { find: ['type task'] } } },
    { op: 'create', ref: 'lay', type: 'lens', title: 'A gone layout', props: { filter: { find: ['type decision'] }, style: { style: 'e_nothere1' } } },
  ]);
  // As a view kept on another map was brought here: a type this map has no pack for, set in place.
  await l.db.query(`update entity set props = jsonb_set(props, '{filter}', '{"find": ["type no_such_type"]}') where id = $1`, [made.odd]);
  const { pictures } = (await callTool(l, human, 'view', { name: 'saved_views', params: {} })) as { pictures: { lens: string; cannot?: string }[] };
  const of = (id: string) => pictures.find((p) => p.lens === id)?.cannot;
  assert.equal(of(made.ok), undefined);
  assert.match(of(made.odd) ?? '', /unknown type "no_such_type"/);
  assert.match(of(made.lay) ?? '', /its layout e_nothere1 is not on this map/);
});
