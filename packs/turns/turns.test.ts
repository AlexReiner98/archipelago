// The turns pack's handler, tested without a database: a run and what a turn said in, the ops that make a task of it
// out (turns.follow_up). The part that sends it is checked in test/turns-part.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { followUp, titleOf } from './handler.js';

const run = { id: 'e_run00001', type: 'run', title: 'Turns as a part', props: { island: 'e_island01' } };

test('a turn followed up is a task about its session, on its island', () => {
  const made = followUp(run, { said: 'Should the row fold open on a press? It keeps one line.', at: '2026-11-12T21:52:44.270Z' });
  assert.deepEqual(made.ops[0].props, { island: 'e_island01' });
  assert.equal(made.ops[0].title, 'Should the row fold open on a press?');
  assert.match(made.ops[0].body, /^Should the row fold open on a press\? It keeps one line\.\n\n## From\nA turn of \[Turns as a part\]\(e_run00001\), 2026-11-12 21:52\.$/);
  assert.deepEqual(made.ops[1], { op: 'link', type: 'about', from: 'task', to: 'e_run00001' });
  assert.equal(followUp({ ...run, props: {} }, { said: 'Do it' }).ops[0].props, undefined, 'a run on no island makes a task on none');
});

test('a turn followed up is part of the work its session was on, and stands where that does', () => {
  const made = followUp(run, { said: 'Do it' }, [{ id: 'e_work0001', type: 'task' }, { id: 'e_work0002', type: 'task' }]);
  assert.equal(made.ops[0].props, undefined, 'its island is the work’s');
  assert.deepEqual(made.ops[2], { op: 'link', type: 'part_of', from: 'task', to: 'e_work0001' });
  assert.equal(made.answer.under, 'e_work0001');
  const lived = followUp({ ...run, props: {} }, { said: 'Do it' }, [], [{ id: 'e_repo0001', type: 'repository', props: { island: 'e_island02' } }]);
  assert.deepEqual(lived.ops[0].props, { island: 'e_island02' }, 'working on nothing, it stands where the session lives');
});

test('a title is a few words, cut at a word', () => {
  const long = titleOf('Make the turns of a session a part of the turns pack, drawn walled in a worker beside findings');
  assert.ok(long.length <= 60, long);
  assert.match(long, /…$/);
  assert.doesNotMatch(long, /\s…$/);
});

test('only a session’s turn, with something said, is followed up', () => {
  assert.throws(() => followUp({ ...run, type: 'task' }, { said: 'x' }), /not a session/);
  assert.throws(() => followUp(null, { said: 'x' }), /not a session/);
  assert.throws(() => followUp(run, { said: '  ' }), /nothing to follow up/);
});
