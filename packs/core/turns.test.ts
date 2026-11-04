// A run's turns worked out from its events (sessions/turns.js, docs/sessions.md): events in, turns out, no database.

import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { turnsOf } from './sessions/turns.js';

const at = (s: number) => new Date(Date.UTC(2026, 10, 4, 0, 0, s)).toISOString();

const asked = [
  { at: at(0), kind: 'session.start', title: 'Turns' },
  { at: at(1), kind: 'turn.start', turn: 't1', by: 'person', gist: 'Make the turns.' },
  { at: at(2), kind: 'tool.end', turn: 't1', tool: 'read', name: 'Read', ok: true },
  { at: at(3), kind: 'tool.end', turn: 't1', tool: 'edit', name: 'Edit', ok: true, files: ['a.js'] },
  { at: at(4), kind: 'tool.end', turn: 't1', tool: 'edit', name: 'Write', ok: true, files: ['a.js', 'b.js'] },
  { at: at(5), kind: 'tool.end', turn: 't1', tool: 'map', name: 'change', ok: true, items: ['e_one'] },
  { at: at(6), kind: 'wait.start', turn: 't1', for: 'permission', gist: 'Run npm test?' },
  { at: at(9), kind: 'wait.end', turn: 't1', for: 'permission' },
  { at: at(10), kind: 'tool.end', turn: 't1', tool: 'shell', name: 'Bash', ok: false },
  { at: at(10), kind: 'test.run', turn: 't1', ok: false, failed: 2, command: 'npm test' },
  { at: at(12), kind: 'test.run', turn: 't1', ok: true, passed: 9, command: 'npm test' },
  { at: at(13), kind: 'commit', turn: 't1', sha: 'abc123', subject: 'Turns' },
  { at: at(14), kind: 'turn.end', turn: 't1', ended: 'asked', question: 'Push it?', gist: 'Done; push it?', tokens: { input: 10, output: 5 } },
];

test('a turn that ends asked carries its question, with its tools, files, waits, tests and commits counted', () => {
  assert.deepEqual(turnsOf(asked), [{
    turn: 't1', began: at(1), ended: at(14), by: 'person', from: null, gist: 'Make the turns.',
    tools: { read: 1, edit: 2, map: 1, shell: 1 }, files: ['a.js', 'b.js'], items: ['e_one'],
    tests: { runs: 2, ok: 1, failed: 1 }, commits: ['abc123'],
    waits: [{ for: 'permission', began: at(6), ended: at(9), gist: 'Run npm test?' }],
    end: 'asked', question: 'Push it?', reply: 'Done; push it?', tokens: { input: 10, output: 5 },
  }]);
});

test('an open turn has no end, and an open wait no ended', () => {
  const [t1, t2] = turnsOf([...asked, { at: at(20), kind: 'turn.start', turn: 't2', by: 'session', from: 'r_parent' }, { at: at(21), kind: 'wait.start', turn: 't2', for: 'input' }]);
  assert.equal(t1.end, 'asked');
  assert.equal(t2.by, 'session');
  assert.equal(t2.from, 'r_parent');
  assert.ok(!('ended' in t2) && !('end' in t2) && !('question' in t2));
  assert.deepEqual(t2.waits, [{ for: 'input', began: at(21) }]);
});

test('events without a turn id go to the turn open at their time, and a turn with no id is named by its start', () => {
  const turns = turnsOf([
    { at: at(0), kind: 'session.start' },
    { at: at(1), kind: 'tool.end', tool: 'read', name: 'Read', ok: true },
    { at: at(2), kind: 'turn.start', by: 'person' },
    { at: at(3), kind: 'tool.end', tool: 'shell', name: 'Bash', ok: true },
    { at: at(4), kind: 'commit', sha: 's1', subject: 'One' },
    { at: at(5), kind: 'turn.end', ended: 'done' },
    { at: at(6), kind: 'tool.end', tool: 'edit', name: 'Edit', ok: true },
    { at: at(7), kind: 'turn.start', by: 'event', from: 'ci' },
    { at: at(8), kind: 'tool.end', tool: 'edit', name: 'Edit', ok: true },
    { at: at(9), kind: 'session.end', reason: 'closed' },
  ]);
  assert.deepEqual(turns.map((t: any) => [t.turn, t.tools, t.commits, t.end]), [
    [at(2), { shell: 1 }, ['s1'], 'done'],
    [at(7), { edit: 1 }, [], undefined],
  ]);
});

test('a resent event is dropped, and the same events give the same turns', () => {
  const resent = [...asked.slice(0, 6), ...asked.slice(2, 6), ...asked.slice(6), asked[11], asked[12]];
  assert.deepEqual(turnsOf(resent), turnsOf(asked));
  assert.deepEqual(turnsOf(asked), turnsOf(structuredClone(asked)));
});

test('turns come in the order they began, an event before its turn.start counted in it', () => {
  const turns = turnsOf([
    { at: at(5), kind: 'turn.start', turn: 'b', by: 'person' },
    { at: at(2), kind: 'tool.end', turn: 'a', tool: 'read', name: 'Read', ok: true },
    { at: at(3), kind: 'turn.start', turn: 'a', by: 'person', gist: 'First.' },
    { at: at(4), kind: 'turn.end', turn: 'a', ended: 'stopped' },
  ]);
  assert.deepEqual(turns.map((t: any) => [t.turn, t.began, t.gist, t.tools, t.end ?? null]), [
    ['a', at(2), 'First.', { read: 1 }, 'stopped'],
    ['b', at(5), null, {}, null],
  ]);
});
