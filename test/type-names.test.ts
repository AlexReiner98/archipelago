// A type is named by what it is, not by the pack that ships it ("What does a type's name say?", decided 27 Oct 2026):
// task, not work.task. A name it had before still reads as the one it has now, in a change, a lens and a search.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatRead } from '../src/query-flat.ts';
import { fresh, make } from './map.ts';

test('a type and a link type are named by what they are, whichever pack ships them', async () => {
  const l = await fresh();
  assert.equal(l.registry.type('task')!.pack, 'work');
  assert.equal(l.registry.type('commit')!.pack, 'software');
  assert.equal(l.registry.type('time_entry')!.pack, 'time');
  assert.equal(l.registry.relations.get('calls')!.root, 'uses');
  assert.equal(l.registry.relations.get('lives_in')!.pack, 'core', "software.lives_in folded into core's");
});

test('an old name still reads as the new one, in a change, a search and a lens', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'r', type: 'software.repo', title: 'Apex repo' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Sign it' },
    { op: 'link', type: 'software.lives_in', from: 't', to: 'r' },
  ]);
  assert.equal((await l.entity(made.t))!.type, 'task');
  assert.equal((await l.entity(made.r))!.type, 'repo');
  assert.deepEqual((await l.search({ type: 'work.task' })).map((e) => e.id), [made.t]);
  assert.ok(l.registry.isA('task', 'work.task'));
  const answer = await flatRead(l, { filter: { find: ['type work.task'] }, walk: { over: ['software.lives_in'], steps: 1 } });
  assert.deepEqual(answer.items.map((i) => i.id).sort(), [made.r, made.t].sort());
  assert.deepEqual(answer.links.map((k) => k.type), ['lives_in']);
});
