// Raw session events (docs/sessions.md): a batch posted to /hooks/events is checked, kept in order on its run, sealed,
// and a batch sent again keeps nothing twice.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fresh, make } from './map.ts';
import { answerHook } from './claude-hook.ts';
import { checkEvent } from '../packs/sessions/kernel/session-events.ts';
import * as sessionEventsPack from '../packs/sessions/kernel/session-events.ts';
import { opEntries } from '../packs/log/kernel/streams.ts';
import { kept } from '../packs/log/kernel/retention.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

const hook = (l: Archipelago, body: Record<string, unknown>) => answerHook('events', { whole: l.db, pelago: l, within: [], body, running: { started: new Date().toISOString() }, origin: 'http://127.0.0.1' }) as Promise<Record<string, unknown>>;

const BATCH = [
  { at: '2026-11-04T00:30:00.000Z', kind: 'session.start', title: 'Fix the lane' },
  { at: '2026-11-04T00:30:01.000Z', kind: 'turn.start', turn: 't1', by: 'person', gist: 'Make the lane wait for its owner.' },
  { at: '2026-11-04T00:30:05.000Z', kind: 'tool.end', turn: 't1', tool: 'edit', name: 'Edit', ok: true, files: ['src/lane.ts'] },
  { at: '2026-11-04T00:30:09.000Z', kind: 'test.run', turn: 't1', ok: false, passed: 3, failed: 1, command: 'npm test' },
  { at: '2026-11-04T00:30:12.000Z', kind: 'turn.end', turn: 't1', ended: 'asked', question: 'Should the lane wait a day?', tokens: { input: 10, output: 4 } },
];

test('a batch is kept in order, a resend keeps nothing twice, and the words are sealed', async () => {
  const l = await fresh();
  const { run } = await make(l, [{ op: 'create', ref: 'run', type: 'run', title: 'A session', props: { session_id: 's1' } }]);

  assert.deepEqual(await hook(l, { session_id: 's1', source: 'claude-code', events: BATCH }), { run, kept: 5, dropped: 0 });
  const back = await sessionEventsPack.sessionEvents(kernelContext(l, 'sessions'), run);
  assert.deepEqual(back, BATCH.map((e) => ({ ...e, source: 'claude-code' })), 'the same events, in order');

  // Sent again with one new event, out of order: the old ones are dropped, the new one is read in its place.
  const late = { at: '2026-11-04T00:30:03.000Z', kind: 'tool.end', turn: 't1', tool: 'read', name: 'Read', ok: true };
  assert.deepEqual(await hook(l, { session_id: 's1', source: 'claude-code', events: [...BATCH, late, late] }), { run, kept: 1, dropped: 6 });
  const again = await sessionEventsPack.sessionEvents(kernelContext(l, 'sessions'), run);
  assert.equal(again.length, 6);
  assert.deepEqual(again.map((e) => e.at), [...BATCH.map((e) => e.at), late.at].sort(), 'read by when they happened');

  // In the stream: event facts on the run, kept by their own rule, their values sealed.
  const entries = (await opEntries(l.db, 'sessions')).filter((e) => e.facts.some((f) => f[2] === 'event'));
  assert.equal(entries.length, 2, 'one entry a batch');
  assert.ok(entries.every((e) => e.rule === 'session_events'));
  assert.ok(!JSON.stringify(entries).includes('wait for its owner'), 'the gist is not in the clear');
  const rules = l.registry.rules;
  const now = new Date(Date.parse(entries[0].at) + 15 * 86_400_000);
  assert.equal(kept(entries, rules, now).size, 0, 'gone after two weeks');
  assert.equal(kept(entries, rules, new Date(Date.parse(entries[0].at) + 86_400_000)).size, 2);
});

test('an event outside the vocabulary is refused, and the rest of its batch kept', async () => {
  const l = await fresh();
  const { run } = await make(l, [{ op: 'create', ref: 'run', type: 'run', title: 'A session', props: { session_id: 's2' } }]);
  const answer = await hook(l, {
    session_id: 's2', source: 'agent-sdk',
    events: [
      { at: '2026-11-04T01:00:00Z', kind: 'turn.start', by: 'person' },
      { at: '2026-11-04T01:00:01Z', kind: 'nap' },
      { at: 'yesterday', kind: 'wait.end', for: 'input' },
      { at: '2026-11-04T01:00:02Z', kind: 'tool.end', tool: 'edit', name: 'Edit' },
      { at: '2026-11-04T01:00:03Z', kind: 'wait.start', for: 'coffee' },
      { at: '2026-11-04T01:00:04Z', kind: 'commit', sha: 'abc', subject: 'x', author: 'me' },
    ],
  });
  assert.deepEqual((answer.refused as { at: number }[]).map((r) => r.at), [1, 2, 3, 4, 5]);
  assert.equal(answer.kept, 1);
  assert.deepEqual((await sessionEventsPack.sessionEvents(kernelContext(l, 'sessions'), run)).map((e) => e.kind), ['turn.start']);
  assert.equal((await hook(l, { session_id: 'nobody', source: 'claude-code', events: BATCH })).run, null, 'no run, nothing kept');
  assert.equal((await hook(l, { session_id: 's2', events: BATCH })).kept, 0, 'an adapter names itself');
});

test('free text is cut to its length', () => {
  const r = checkEvent({ at: '2026-11-04T01:00:00Z', kind: 'turn.end', ended: 'asked', question: 'q'.repeat(600), gist: 'g'.repeat(300) });
  assert.ok('event' in r);
  assert.equal((r.event.question as string).length, 500);
  assert.equal((r.event.gist as string).length, 200);
});
