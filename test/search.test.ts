// Search as the Search screen asks it: work without the system's own records, how many of each type, and pictures by name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool } from '../src/tools.ts';
import { fresh, human, make } from './map.ts';

test('search can leave out sources, and the kinds view counts every type however many there are', async () => {
  const l = await fresh();
  await l.change(human, {
    reason: 'test',
    source: { uri: 'docs/kernel.md' },
    ops: [
      { op: 'create', type: 'work.note', title: 'The kernel, cut down' },
      { op: 'create', type: 'work.note', title: 'Kernel notes' },
      { op: 'create', type: 'work.task', title: 'Cut the kernel', status: 'done' },
    ],
  });
  const types = async (input: Record<string, unknown>) => (await callTool(l, human, 'search', input) as { type: string }[]).map((e) => e.type).sort();
  assert.ok((await types({})).includes('sys.source'), 'sources are found as before when nothing says otherwise');
  assert.deepEqual(await types({ system: false }), ['work.note', 'work.note', 'work.task']);
  assert.deepEqual(await types({ type: 'sys.source', system: false }), [], 'leaving the system out holds even with a type');

  const counted = await callTool(l, human, 'view', { name: 'kinds', params: { system: false } });
  assert.deepEqual(counted, [{ type: 'work.note', count: 2 }, { type: 'work.task', count: 1 }]);
  assert.deepEqual(await callTool(l, human, 'view', { name: 'kinds', params: { system: false, open: true } }), [{ type: 'work.note', count: 2 }], 'only the unfinished');
});

test('the atlas finds a picture by its own name or by the title of what it is of', async () => {
  const l = await fresh();
  await make(l, [
    { op: 'create', ref: 'stack', type: 'software.component', title: 'Sovereign AI stack', status: 'wiring' },
    { op: 'create', ref: 'wired', type: 'lens', title: 'The stack as wired', status: 'current', props: { kinds: ['software.component'] } },
    { op: 'create', ref: 'arch', type: 'style', title: 'System architecture', status: 'current', props: { shape: 'architecture' } },
    { op: 'link', type: 'about', from: 'wired', to: 'stack' },
    { op: 'link', type: 'about', from: 'arch', to: 'wired' },
    { op: 'create', type: 'lens', title: 'Kanban board', status: 'current' },
  ]);
  const found = async (q: string) => ((await callTool(l, human, 'view', { name: 'atlas', params: { q } })) as { pictures: { title: string }[] }).pictures.map((p) => p.title);
  assert.deepEqual(await found('architecture'), ['System architecture'], 'by the style that names it');
  assert.deepEqual(await found('sovereign stack'), ['System architecture'], 'by what it is of, each word anywhere');
  assert.deepEqual(await found('kanban'), ['Kanban board']);
  assert.deepEqual(await found('garden'), []);
  assert.equal((await found('')).length, 2, 'no words, every picture');
});
