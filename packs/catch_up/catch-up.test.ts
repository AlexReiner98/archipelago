// The catch_up pack's parts with nothing but their own code: rows as they were and are in, a change set, traces and
// steps out. The same parts against the projector and the host's check of their marks: test/catch-up-parts.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: plain modules of the pack, with no types of their own.
import { changeSet, said, whoSaid } from './parts/changes.js';
// @ts-expect-error: plain modules of the pack, with no types of their own.
import { keptOf, sawIt, trace, traceBook, traceMarks } from './parts/traces.js';
// @ts-expect-error: plain modules of the pack, with no types of their own.
import { changedCount, stepsOf } from './parts/steps.js';

const task = (title: string, status = 'todo', island?: string) => ({ type: 'task', title, status, body: '', owner: null, visibility: 'workspace', props: island ? { island } : {}, archived_at: null });
const by = { actor: 'agent:claude', word: 'Coll', reason: 'Started it. Then more.' };

test('rows as they were and are make a change set, and the line a trace says', () => {
  const set = changeSet({
    from: 1, to: 2,
    rows: [
      { id: 'e_aaaaaaaa', was: task('A'), now: task('A', 'doing'), by, pos: 2 },
      { id: 'e_bbbbbbbb', was: null, now: task('B'), by, pos: 2 },
      { id: 'e_cccccccc', was: task('C'), now: task('C'), by, pos: 2 },
      { id: 'r_aaaaaaaa', was: null, now: { type: 'depends_on', from_id: 'e_bbbbbbbb', to_id: 'e_aaaaaaaa', props: {}, valid_to: null }, by, pos: 2 },
    ],
  });
  assert.deepEqual(set.items.map((c: any) => [c.id, c.did]), [['e_aaaaaaaa', 'changed'], ['e_bbbbbbbb', 'came']]);
  assert.equal(said(set.items[0]), 'doing');
  assert.equal(said(set.links[0]), 'linked depends on');
  assert.equal(whoSaid(by), 'Session Coll');

  const book = traceBook(undefined);
  assert.equal(trace(book, set, 'agent:claude'), false, 'one\'s own change is not traced');
  assert.equal(trace(book, set, 'human:alex'), true);
  assert.deepEqual(traceMarks(book)[0], ['trace', { item: 'e_aaaaaaaa', tip: 'Session Coll, doing: Started it', hue: 'Coll' }]);
  assert.equal(sawIt(book, 'e_aaaaaaaa', 10), true);
  const kept = keptOf(book, 10, 30);
  assert.equal(trace(traceBook(kept), set, 'human:alex'), true, 'the others still wait');
  assert.equal(traceMarks(traceBook(kept)).some((m: any) => m[1].item === 'e_aaaaaaaa'), false, 'what was seen is not traced again');
});

test('steps are chapters by maker, each island its own', () => {
  const entries = [
    { pos: 2, by, facts: [['+', 'e_aaaaaaaa', 'status', 'doing'], ['+', 'e_bbbbbbbb', 'status', 'doing']], rows: [{ id: 'e_aaaaaaaa', was: task('A', 'todo', 'e_islanda1'), now: task('A', 'doing', 'e_islanda1') }, { id: 'e_bbbbbbbb', was: task('B', 'todo', 'e_islandb1'), now: task('B', 'doing', 'e_islandb1') }] },
    { pos: 3, by: { actor: 'agent:other', run: 'e_run00002' }, facts: [['+', 'e_aaaaaaaa', 'title', 'A2']], rows: [{ id: 'e_aaaaaaaa', was: task('A', 'doing'), now: task('A2', 'doing') }] },
  ];
  const steps = stepsOf(entries, { islands: { e_aaaaaaaa: 'e_islanda1', e_bbbbbbbb: 'e_islandb1' } });
  assert.deepEqual(steps.map((s: any) => [s.chapter, s.island, s.pos, s.ids]), [[0, 'e_islanda1', 2, ['e_aaaaaaaa']], [0, 'e_islandb1', 2, ['e_bbbbbbbb']], [1, 'e_islanda1', 3, ['e_aaaaaaaa']]]);
  assert.equal(changedCount(steps), 2);
});

test('a part mounted after the slot was told hears the last it was told', async () => {
  // @ts-expect-error: plain modules of the pack, with no types of their own.
  const replay = (await import('./parts/replay.js')).default;
  // @ts-expect-error: plain modules of the pack, with no types of their own.
  const traced = (await import('./parts/traced.js')).default;
  const entries = [{ pos: 2, by, facts: [['+', 'e_aaaaaaaa', 'status', 'doing']], rows: [{ id: 'e_aaaaaaaa', was: task('A'), now: task('A', 'doing') }] }];
  assert.match(JSON.stringify(replay({ told: { name: 'missed', entries } }, {}).marks), /"1 changed"/);
  const rows = [{ id: 'e_aaaaaaaa', was: task('A'), now: task('A', 'doing'), by, pos: 2 }];
  assert.equal(traced({ me: 'human:alex', told: { name: 'beat', from: 1, to: 2, rows } }, {}).marks.length, 3);
});
