// Saved views: every picture kept on the map, named by the style that draws it, with what it is of, the pinned first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool } from '../src/tools.ts';
import { fresh, human, make } from './map.ts';

test('saved views name each kept picture by its style, says what it is of, and puts the pinned first, and names the project it is in', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'proj', type: 'project', title: 'Archipelago', status: 'active' },
    { op: 'create', ref: 'stream', type: 'feature', title: 'A sovereign stack', status: 'planned' },
    { op: 'create', ref: 'stack', type: 'component', title: 'Sovereign AI stack', status: 'wiring' },
    { op: 'link', type: 'part_of', from: 'stream', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'stack', to: 'stream' },
    { op: 'create', ref: 'wired', type: 'lens', title: 'The stack as wired', status: 'current', props: { filter: { find: ['type component'] } } },
    { op: 'create', ref: 'arch', type: 'style', title: 'The stack as architecture', status: 'current', props: { shape: 'architecture' } },
    { op: 'link', type: 'about', from: 'wired', to: 'stack' },
    { op: 'link', type: 'about', from: 'arch', to: 'wired' },
    { op: 'create', ref: 'board', type: 'lens', title: 'Kanban board', status: 'current', props: { pinned: true } },
  ]);
  const { pictures, more } = (await callTool(l, human, 'view', { name: 'saved_views', params: {} })) as { pictures: Record<string, unknown>[]; more: number };
  assert.deepEqual(pictures, [
    { lens: made.board, title: 'Kanban board', pinned: true },
    { lens: made.wired, title: 'The stack as architecture', shape: 'architecture', of: { id: made.stack, title: 'Sovereign AI stack', type: 'component' }, project: { id: made.proj, title: 'Archipelago' }, pinned: false },
  ]);
  assert.equal(more, 0);
  const one = (await callTool(l, human, 'view', { name: 'saved_views', params: { limit: 1 } })) as { pictures: unknown[]; more: number };
  assert.deepEqual([one.pictures.length, one.more], [1, 1]);
});

test('a view a document brings in says which document, and an archived document no longer holds it', async () => {
  const l = await fresh();
  const { view, loose } = await make(l, [
    { op: 'create', ref: 'view', type: 'lens', title: 'In a page', status: 'current', props: { filter: { find: ['type project'] } } },
    { op: 'create', ref: 'loose', type: 'lens', title: 'On its own', status: 'current', props: { filter: { find: ['type project'] } } },
  ]);
  const { doc } = await make(l, [{ op: 'create', ref: 'doc', type: 'document', title: 'A page', body: `Words.\n\n${view}\n\nMore words.` }]);
  const read = async () => ((await callTool(l, human, 'view', { name: 'saved_views', params: {} })) as { pictures: { lens: string; document?: { id: string; title: string } }[] }).pictures;
  const pictures = await read();
  assert.deepEqual(pictures.find((p) => p.lens === view)?.document, { id: doc, title: 'A page' });
  assert.equal(pictures.find((p) => p.lens === loose)?.document, undefined);
  await l.change(human, { reason: 'test', ops: [{ op: 'archive', id: doc }] });
  assert.equal((await read()).find((p) => p.lens === view)?.document, undefined);
});
