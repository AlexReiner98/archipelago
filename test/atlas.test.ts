// The atlas: every picture kept on the map, named by the style that draws it, with what it is of, the pinned first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool } from '../src/tools.ts';
import { fresh, human, make } from './map.ts';

test('the atlas names each kept picture by its style, says what it is of, and puts the pinned first, and names the project it is in', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'proj', type: 'work.project', title: 'Archipelago', status: 'active' },
    { op: 'create', ref: 'stream', type: 'software.feature', title: 'A sovereign stack', status: 'planned' },
    { op: 'create', ref: 'stack', type: 'software.component', title: 'Sovereign AI stack', status: 'wiring' },
    { op: 'link', type: 'part_of', from: 'stream', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'stack', to: 'stream' },
    { op: 'create', ref: 'wired', type: 'lens', title: 'The stack as wired', status: 'current', props: { kinds: ['software.component'] } },
    { op: 'create', ref: 'arch', type: 'style', title: 'The stack as architecture', status: 'current', props: { shape: 'architecture' } },
    { op: 'link', type: 'about', from: 'wired', to: 'stack' },
    { op: 'link', type: 'about', from: 'arch', to: 'wired' },
    { op: 'create', ref: 'board', type: 'lens', title: 'Kanban board', status: 'current', props: { pinned: true } },
  ]);
  const { pictures, more } = (await callTool(l, human, 'view', { name: 'atlas', params: {} })) as { pictures: Record<string, unknown>[]; more: number };
  assert.deepEqual(pictures, [
    { lens: made.board, title: 'Kanban board', pinned: true },
    { lens: made.wired, title: 'The stack as architecture', shape: 'architecture', of: { id: made.stack, title: 'Sovereign AI stack', type: 'software.component' }, project: { id: made.proj, title: 'Archipelago' }, pinned: false },
  ]);
  assert.equal(more, 0);
  const one = (await callTool(l, human, 'view', { name: 'atlas', params: { limit: 1 } })) as { pictures: unknown[]; more: number };
  assert.deepEqual([one.pictures.length, one.more], [1, 1]);
});
