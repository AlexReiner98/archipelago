// A run's state and line, wired (docs/sessions.md, "Wired: what the server gives"): events posted to /hooks/events move
// it, and the sessions view and the flat answer say where it stands, the sessions view in the order of attention.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fresh, human, make } from './map.ts';
import { answerHook } from '../src/hook-answers.ts';
import { callTool } from '../src/tools.ts';
import { sessionState, sessionStates } from '../src/session-state.ts';
import { tell } from '../src/sessions.ts';
import type { Archipelago } from '../src/pelago.ts';

const post = (l: Archipelago, session_id: string, events: Record<string, unknown>[]) =>
  answerHook('events', { whole: l.db, pelago: l, within: [], body: { session_id, source: 'claude-code', events }, running: { started: new Date().toISOString() }, origin: 'http://127.0.0.1' }) as Promise<Record<string, unknown>>;
const view = async (l: Archipelago, name: string, params: Record<string, unknown> = {}) => (await callTool(l, human, 'view', { name, params })) as any;
const openRuns = async (l: Archipelago) => (await view(l, 'sessions')).open as { id: string; session: Record<string, unknown>; turn?: Record<string, unknown> }[];
const flatOf = async (l: Archipelago, id: string) => (await view(l, 'flat', { filter: { find: [`id ${id}`], not: [] } })).items.find((i: { id: string }) => i.id === id);

// Events from a minute ahead of the clock, so what the run was told by the clock (a beat) comes before them.
const base = Math.ceil(Date.now() / 60_000) * 60_000 + 60_000;
const at = (minute: number) => new Date(base + minute * 60_000).toISOString();

test("a run's state and line move as its events arrive", async () => {
  const l = await fresh();
  const { run, task } = await make(l, [
    { op: 'create', ref: 'run', type: 'run', title: 'A session', props: { session_id: 's1' } },
    { op: 'create', ref: 'task', type: 'task', title: 'Make the lane wait' },
    { op: 'link', type: 'works_on', from: 'run', to: 'task' },
  ]);

  // No turn yet: idle, its line what it works on.
  let s = await sessionState(l, run);
  assert.equal(s?.state, 'idle');
  assert.equal(s?.line, 'Make the lane wait');
  assert.equal(s?.turns, 0);

  await post(l, 's1', [{ at: at(0), kind: 'turn.start', turn: 't1', by: 'person', gist: 'Make the lane wait.' }]);
  s = await sessionState(l, run, at(1));
  assert.equal(s?.state, 'working');
  assert.equal(s?.since, at(0));
  assert.equal(s?.turn?.turn, 't1');
  assert.equal((await openRuns(l))[0].session.state, 'working', 'the sessions view says it');
  assert.equal((await flatOf(l, run)).session.state, 'working', 'and so does the flat answer');

  // It stops to ask for a permission: waiting, for permission.
  await post(l, 's1', [{ at: at(2), kind: 'wait.start', turn: 't1', for: 'permission', gist: 'Run npm test' }]);
  s = await sessionState(l, run, at(3));
  assert.deepEqual([s?.state, s?.for, s?.since], ['waiting', 'permission', at(2)]);
  const [row] = await openRuns(l);
  assert.deepEqual(row.session, { state: 'waiting', for: 'permission', line: 'Run npm test', since: at(2) });
  assert.deepEqual((await flatOf(l, run)).session, row.session);

  // Answered, then a beat told: working again, its line the beat.
  await post(l, 's1', [{ at: at(3), kind: 'wait.end', turn: 't1', for: 'permission' }]);
  await tell(l, human, { run, said: 'The lane waits on its owner now.' });
  s = await sessionState(l, run, at(4));
  assert.deepEqual([s?.state, s?.line], ['working', 'The lane waits on its owner now.']);

  // It ends on a question: your move, its line the question.
  await post(l, 's1', [{ at: at(5), kind: 'turn.end', turn: 't1', ended: 'asked', question: 'Should the lane wait a day?' }]);
  s = await sessionState(l, run, at(6));
  assert.deepEqual([s?.state, s?.line, s?.since], ['your_move', 'Should the lane wait a day?', at(5)]);
  assert.equal((await openRuns(l))[0].turn?.question, 'Should the lane wait a day?', 'the view carries its latest turn');

  // Its turn ended: waiting on its person however long, never quiet.
  s = await sessionState(l, run, at(5 + 90));
  assert.equal(s?.state, 'your_move', 'a question waits');
  // A turn under way, silent past the house style's quiet_after (30 minutes): quiet.
  await post(l, 's1', [{ at: at(7), kind: 'turn.start', turn: 't2', by: 'person', gist: 'Make it a day.' }]);
  s = await sessionState(l, run, at(7 + 29));
  assert.equal(s?.state, 'working', 'not yet');
  s = await sessionState(l, run, at(7 + 30));
  assert.equal(s?.state, 'quiet');

  // What it works on waits on open work: blocked.
  const { other } = await make(l, [{ op: 'create', ref: 'other', type: 'task', title: 'The owner decides' }]);
  await make(l, [{ op: 'link', type: 'depends_on', from: task, to: other }]);
  await post(l, 's1', [{ at: at(7), kind: 'turn.start', turn: 't2', by: 'person' }, { at: at(8), kind: 'turn.end', turn: 't2', ended: 'done' }]);
  s = await sessionState(l, run, at(9));
  assert.equal(s?.state, 'blocked');
  assert.equal(s?.turns, 2);
});

test('the sessions view orders open runs by attention, and many runs take one read', async () => {
  const l = await fresh();
  const made = await make(l, ['a', 'b', 'c', 'd'].map((x) => ({ op: 'create' as const, ref: x, type: 'run', title: `Session ${x}`, props: { session_id: `s${x}` } })));
  await post(l, 'sa', [{ at: at(0), kind: 'turn.start', turn: 't', by: 'person' }]); // working
  await post(l, 'sb', [{ at: at(0), kind: 'turn.start', turn: 't', by: 'person' }, { at: at(1), kind: 'turn.end', turn: 't', ended: 'asked', question: 'Which?' }]); // your move
  await post(l, 'sc', [{ at: at(0), kind: 'turn.start', turn: 't', by: 'person' }, { at: at(2), kind: 'wait.start', turn: 't', for: 'input' }]); // waiting
  await post(l, 'sd', [{ at: at(0), kind: 'turn.start', turn: 't', by: 'person' }, { at: at(1), kind: 'turn.end', turn: 't', ended: 'done' }]); // idle
  const ids = (await openRuns(l)).map((r) => r.id);
  assert.deepEqual(ids, [made.c, made.b, made.a, made.d]);

  const states = await sessionStates(l, [made.a, made.b, made.c, made.d, 'e_nothing'], at(3));
  assert.deepEqual([...states.keys()].sort(), [made.a, made.b, made.c, made.d].sort(), 'a run not found is left out');
  assert.equal(states.get(made.c)?.for, 'input');
  assert.equal(states.get(made.b)?.line, 'Which?');
});
