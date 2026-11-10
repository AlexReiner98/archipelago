// What turns tell (docs/sessions.md, task 11): runs and their events seeded, and each of the three answers checked:
// who waits on their person now and since when, turns and tokens per item worked on, and who has stalled.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fresh, make } from './map.ts';
import { answerHook } from './claude-hook.ts';
import { sessionMeasures } from '../src/session-measures.ts';
import { VIEWS } from '../src/views.ts';
import type { Archipelago } from '../src/pelago.ts';

const send = (l: Archipelago, session_id: string, events: Record<string, unknown>[]) =>
  answerHook('events', { whole: l.db, pelago: l, within: [], body: { session_id, source: 'claude-code', events }, running: { started: new Date().toISOString() }, origin: 'http://127.0.0.1' });

const NOW = Date.now();
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const turn = (id: string, began: number, ended: number | null, end: Record<string, unknown> = {}, between: Record<string, unknown>[] = []) => [
  { at: ago(began), kind: 'turn.start', turn: id, by: 'person' },
  ...between.map((e) => ({ turn: id, ...e })),
  ...(ended === null ? [] : [{ at: ago(ended), kind: 'turn.end', turn: id, ended: 'done', ...end }]),
];

async function seed() {
  const l = await fresh();
  const ids = await make(l, [
    { op: 'create', ref: 'lane', type: 'task', title: 'Fix the lane' },
    { op: 'create', ref: 'dock', type: 'task', title: 'Build the dock' },
    { op: 'create', ref: 'a', type: 'run', title: 'Asks a question', props: { session_id: 'sa' } },
    { op: 'create', ref: 'b', type: 'run', title: 'Waits for a permission', props: { session_id: 'sb' } },
    { op: 'create', ref: 'c', type: 'run', title: 'Moves along', props: { session_id: 'sc' } },
    { op: 'link', type: 'works_on', from: 'a', to: 'lane' },
    { op: 'link', type: 'works_on', from: 'b', to: 'lane' },
    { op: 'link', type: 'works_on', from: 'c', to: 'dock' },
  ]);
  await send(l, 'sa', [
    ...turn('a1', 50, 45, { tokens: { input: 100, output: 10 } }),
    ...turn('a2', 40, 30, { ended: 'asked', question: 'Should the lane wait a day?', tokens: { input: 200, output: 20 } }),
  ]);
  await send(l, 'sb', [
    ...turn('b1', 150, 80, { tokens: { input: 50, output: 5 } }, [{ at: ago(100), kind: 'test.run', ok: false, failed: 2 }]),
    ...turn('b2', 12, null, {}, [{ at: ago(10), kind: 'wait.start', for: 'permission', gist: 'Run npm test?' }]),
  ]);
  await send(l, 'sc', [
    ...turn('c1', 200, 120, {}, [{ at: ago(130), kind: 'commit', sha: 'abc', subject: 'Dock' }]),
    ...turn('c2', 100, 70, { tokens: { input: 1, output: 1 } }),
  ]);
  return { l, ...ids } as { l: Archipelago } & Record<string, string>;
}

test('who waits on their person now, and since when, oldest first', async () => {
  const { l, a, b, c } = await seed();
  const m = await sessionMeasures(l, { until: new Date(NOW).toISOString() });
  assert.deepEqual(m.waiting.map((w) => [w.run, w.for, w.since, w.minutes]), [[a, 'answer', ago(30), 30], [b, 'permission', ago(10), 10]]);
  assert.equal(m.waiting[0].question, 'Should the lane wait a day?');
  assert.ok(!m.waiting.some((w) => w.run === c), 'a run whose last turn ended done waits on no one');

  // A later turn answers the question: it waits no more.
  await send(l, 'sa', turn('a3', 5, 2));
  assert.deepEqual((await sessionMeasures(l, { until: new Date(NOW).toISOString() })).waiting.map((w) => w.run), [b]);
});

test('turns and tokens per item worked on, most turns first', async () => {
  const { l, lane, dock, a } = await seed();
  const m = await sessionMeasures(l, { until: new Date(NOW).toISOString() });
  assert.deepEqual(m.per_item.map((x) => [x.id, x.turns, x.tokens.input, x.tokens.output, x.runs]), [[lane, 4, 350, 35, 2], [dock, 2, 1, 1, 1]]);
  assert.equal(m.per_item[0].title, 'Fix the lane');

  // A range counts the turns begun in it alone.
  const late = await sessionMeasures(l, { since: ago(60), until: new Date(NOW).toISOString() });
  assert.deepEqual(late.per_item.map((x) => [x.id, x.turns]), [[lane, 3]]);

  // A run that names nothing it works on has its turns counted under itself.
  const { lone } = await make(l, [{ op: 'create', ref: 'lone', type: 'run', title: 'On nothing', props: { session_id: 'sl' } }]);
  await send(l, 'sl', turn('l1', 20, 15));
  const again = await sessionMeasures(l, { until: new Date(NOW).toISOString() });
  assert.deepEqual(again.per_item.find((x) => x.id === lone), { id: lone, title: 'On nothing', type: 'run', turns: 1, tokens: { input: 0, output: 0 }, runs: 1 });
  assert.ok(again.per_item.every((x) => x.id !== a));
});

test('a session with an hour of turns and no passing test or commit has stalled', async () => {
  const { l, b, c } = await seed();
  const m = await sessionMeasures(l, { until: new Date(NOW).toISOString() });
  assert.deepEqual(m.stalled.map((s) => [s.run, s.turns, s.moved]), [[b, 2, null]]);
  assert.equal(m.stalled[0].minutes, 70 + 12, 'its closed turn and its open one, to now');
  assert.ok(!m.stalled.some((s) => s.run === c), 'a commit 2 hours ago, then half an hour of turns');

  // Its tests pass: it has moved.
  await send(l, 'sb', [{ at: ago(1), kind: 'test.run', turn: 'b2', ok: true, passed: 5 }]);
  assert.deepEqual((await sessionMeasures(l, { until: new Date(NOW).toISOString() })).stalled, []);
  assert.equal((await sessionMeasures(l, { until: new Date(NOW).toISOString(), stall_minutes: 20 })).stalled[0]?.run, c, 'a lower bar');
});

test('the view answers the same, a week to now unless said', async () => {
  const { l } = await seed();
  const m = (await VIEWS.session_measures.run(l, {})) as Awaited<ReturnType<typeof sessionMeasures>>;
  assert.equal(Date.parse(m.until) - Date.parse(m.since), 7 * 86_400_000);
  assert.equal(m.waiting.length, 2);
  assert.equal(m.stall_minutes, 60);
});
