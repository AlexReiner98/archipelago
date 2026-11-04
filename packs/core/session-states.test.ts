// A session's state and line from its turns (sessions/states.js), tested without a database: a run and its turns in,
// { state, for?, line, since } out. One case per state, then the order between them, then the line's fallbacks. The
// test sits beside the pack file, not in sessions/, because the full run collects a pack's tests one folder deep.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { STATES, lineOf, stateOf } from './sessions/states.js';

const NOW = '2026-11-04T12:00:00.000Z';
const ago = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
const QUIET = 30;
const open = { open: true, status: 'running', started: ago(120) };
const turn = (began: number, more: Record<string, unknown> = {}) => ({ turn: `t${began}`, began: ago(began), by: 'person', from: null, tools: {}, files: [], items: [], tests: { runs: 0, ok: 0, failed: 0 }, commits: [], waits: [], ...more });
const ended = (began: number, at: number, end: string, more: Record<string, unknown> = {}) => turn(began, { ended: ago(at), end, ...more });
const state = (input: Record<string, unknown>) => stateOf({ run: open, now: NOW, quiet_after: QUIET, title: 'Session states', ...input });

test('the states are one table, in the contract order', () => {
  assert.deepEqual(STATES.map((s: any) => s.state), ['done', 'waiting', 'blocked', 'quiet', 'working', 'your_move', 'idle']);
});

test('done: the run is closed', () => {
  assert.deepEqual(state({ run: { open: false, status: 'done', ended: ago(5) }, turns: [ended(10, 5, 'done')] }), { state: 'done', line: 'Session states', since: ago(5) });
});

test('waiting: a wait with no end, and what for', () => {
  const t = turn(10, { waits: [{ for: 'permission', began: ago(4) }] });
  assert.deepEqual(state({ turns: [t] }), { state: 'waiting', for: 'permission', line: 'Session states', since: ago(4) });
  // A wait the caller hands over counts as one read off the turn.
  assert.equal(state({ turns: [ended(20, 15, 'done')], wait: { for: 'input', began: ago(2) } }).for, 'input');
  // An answered wait is not one.
  assert.equal(state({ turns: [turn(10, { waits: [{ for: 'permission', began: ago(4), ended: ago(3) }] })] }).state, 'working');
});

test('blocked: held for a resource, or on an item with an open depends_on', () => {
  // A chat's run waits once its agent says it is done: that is not blocked.
  assert.equal(state({ run: { ...open, status: 'waiting' }, turns: [ended(10, 5, 'done')] }).state, 'idle');
  assert.equal(state({ turns: [ended(10, 5, 'done')], blocked: { since: ago(8) } }).since, ago(8));
  assert.equal(state({ turns: [ended(10, 5, 'done')], blocked: true }).state, 'blocked');
});

test('working: its latest turn is open', () => {
  assert.deepEqual(state({ turns: [ended(30, 25, 'done'), turn(10)] }), { state: 'working', line: 'Session states', since: ago(10) });
  // A run that has sent no events yet is working while its heartbeat says busy, and quiet once that goes silent.
  assert.deepEqual(state({ run: { ...open, busy: true }, turns: [], last: ago(2) }), { state: 'working', line: 'Session states', since: ago(2) });
  assert.equal(state({ run: { ...open, busy: true }, turns: [], last: ago(40) }).state, 'quiet');
  assert.equal(state({ run: { ...open, busy: false }, turns: [], last: ago(2) }).state, 'idle');
});

test('quiet: a turn under way, no event for quiet_after minutes', () => {
  assert.deepEqual(state({ turns: [turn(40)] }), { state: 'quiet', line: 'Session states', since: ago(40) });
  // The latest event the caller knows of counts, and the threshold is the caller's.
  assert.equal(state({ turns: [turn(40)], last: ago(10) }).state, 'working');
  assert.equal(state({ turns: [turn(40)], quiet_after: 60 }).state, 'working');
  assert.equal(state({ turns: [turn(40)], quiet_after: undefined }).state, 'working');
  // A turn that ended is waiting on its person, however long: never quiet.
  assert.equal(state({ turns: [ended(60, 40, 'asked', { question: 'Merge it?' })] }).state, 'your_move');
  assert.equal(state({ turns: [ended(60, 40, 'done')] }).state, 'idle');
});

test('your_move: its latest turn ended asked, stopped or failed', () => {
  for (const end of ['asked', 'stopped', 'failed'])
    assert.deepEqual(state({ turns: [ended(10, 5, end)] }), { state: 'your_move', line: 'Session states', since: ago(5) }, end);
});

test('idle: its latest turn ended done, or it has none yet', () => {
  assert.deepEqual(state({ turns: [ended(10, 5, 'done')] }), { state: 'idle', line: 'Session states', since: ago(5) });
  assert.deepEqual(state({ run: { ...open, started: ago(2) }, turns: [] }), { state: 'idle', line: 'Session states', since: ago(2) });
});

test('the first that holds wins', () => {
  const waitingTurn = turn(10, { waits: [{ for: 'input', began: ago(4) }] });
  // Closed beats an open wait; an open wait beats blocked and an open turn.
  assert.equal(state({ run: { open: false, status: 'done' }, turns: [waitingTurn] }).state, 'done');
  assert.equal(state({ turns: [waitingTurn], blocked: true }).state, 'waiting');
  // Blocked beats an open turn; quiet beats working, for a turn under way that has gone silent.
  assert.equal(state({ turns: [turn(10)], blocked: true }).state, 'blocked');
  assert.equal(state({ turns: [turn(90)] }).state, 'quiet');
  // Your move however long ago it asked; only the latest turn's end counts.
  assert.equal(state({ turns: [ended(90, 60, 'asked')] }).state, 'your_move');
  assert.equal(state({ turns: [ended(30, 20, 'asked'), ended(10, 5, 'done')] }).state, 'idle');
  assert.equal(state({ turns: [ended(30, 20, 'done'), ended(10, 5, 'failed')] }).state, 'your_move');
});

test('the line: the question, else the latest beat, else the title', () => {
  const asked = ended(10, 5, 'asked', { question: 'Push it now?' });
  assert.equal(lineOf({ turns: [asked], beat: { said: 'Tests pass.' }, title: 'Session states' }), 'Push it now?');
  assert.equal(lineOf({ turns: [ended(10, 5, 'done')], beat: { said: 'Tests pass.' }, title: 'Session states' }), 'Tests pass.');
  assert.equal(lineOf({ turns: [], beat: 'Found the cause.', title: 'Session states' }), 'Found the cause.');
  assert.equal(lineOf({ turns: [ended(10, 5, 'done')], title: 'Session states' }), 'Session states');
  assert.equal(lineOf({}), '');
  // With no question or beat, what its latest turn was asked to do, before the title.
  assert.equal(lineOf({ turns: [turn(10, { gist: 'Deal the shards by time' })], title: 'Session states' }), 'Deal the shards by time');
  // An open wait says what it waits on, before any question.
  assert.equal(lineOf({ turns: [turn(10, { waits: [{ for: 'permission', began: ago(4), gist: 'Run gh run list' }] })], title: 'Session states' }), 'Run gh run list');
  // Only the latest turn's question: an earlier one is answered.
  assert.equal(lineOf({ turns: [asked, turn(3)], title: 'Session states' }), 'Session states');
});
