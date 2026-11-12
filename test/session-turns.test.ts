// A run's turns as a read (packs/sessions/kernel/session-turns.ts, docs/sessions.md "Wired"): the events its adapter sent, worked out
// into turns, newest first, with the name of a session that started one, and a limit that counts what it left out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fresh, make } from './map.ts';
import { answerHook } from './claude-hook.ts';
import { VIEWS } from '../packs/query/kernel/views.ts';
import '../packs/sessions/kernel/session-turns.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

const hook = (l: Archipelago, body: Record<string, unknown>) => answerHook('events', { whole: l.db, pelago: l, within: [], body, running: { started: new Date().toISOString() }, origin: 'http://127.0.0.1' }) as Promise<Record<string, unknown>>;
const at = (s: number) => new Date(Date.UTC(2026, 10, 4, 0, 0, s)).toISOString();

test('a run’s turns are read newest first, each with who started it and how it ended', async () => {
  const l = await fresh();
  const { run, parent } = await make(l, [
    { op: 'create', ref: 'parent', type: 'run', title: 'Session Sark', props: { session_id: 'p1' } },
    { op: 'create', ref: 'run', type: 'run', title: 'A session', props: { session_id: 's1' } },
  ]);
  const events = [
    { at: at(0), kind: 'session.start', title: 'Turns' },
    { at: at(1), kind: 'turn.start', turn: 't1', by: 'session', from: parent, gist: 'Build the turns read.' },
    { at: at(2), kind: 'tool.end', turn: 't1', tool: 'edit', name: 'Edit', ok: true, files: ['src/a.ts'] },
    { at: at(3), kind: 'tool.end', turn: 't1', tool: 'edit', name: 'Edit', ok: true, files: ['src/a.ts'] },
    { at: at(4), kind: 'test.run', turn: 't1', ok: false, passed: 3, failed: 1 },
    { at: at(5), kind: 'turn.end', turn: 't1', ended: 'asked', question: 'Should a turn show its files? Or only their count.', tokens: { input: 10, output: 4 } },
    { at: at(6), kind: 'turn.start', turn: 't2', by: 'person', gist: 'Only the count.' },
    { at: at(7), kind: 'commit', turn: 't2', sha: 'abc1234', subject: 'Turns' },
  ];
  assert.equal((await hook(l, { session_id: 's1', source: 'claude-code', events })).kept, events.length);

  const read = (params: Record<string, unknown>) => VIEWS.turns.run(kernelContext(l, 'query'), params) as Promise<{ run: { id: string }; turns: Record<string, any>[]; more: number; names: Record<string, { title: string; name?: string }> }>;
  const all = await read({ run });
  assert.equal(all.run.id, run);
  assert.deepEqual(all.turns.map((t) => t.turn), ['t2', 't1'], 'newest first');
  const [open, asked] = all.turns;
  assert.equal(open.end, undefined, 'an open turn has no end');
  assert.deepEqual(open.commits, ['abc1234']);
  assert.equal(asked.by, 'session');
  assert.deepEqual(asked.tools, { edit: 2 });
  assert.deepEqual(asked.tests, { runs: 1, ok: 0, failed: 1 });
  assert.equal(asked.end, 'asked');
  assert.equal(asked.question, 'Should a turn show its files? Or only their count.');
  assert.deepEqual(asked.tokens, { input: 10, output: 4 });
  assert.deepEqual(all.names, { [parent]: { title: 'Session Sark' } }, 'the session that started one, by name');
  assert.equal(all.more, 0);

  // By its session id too; a limit keeps the newest and counts the rest.
  const one = await read({ run: 's1', limit: 1 });
  assert.deepEqual(one.turns.map((t) => t.turn), ['t2']);
  assert.equal(one.more, 1);
  assert.deepEqual(one.names, {}, 'only the names of what it shows');

  await assert.rejects(read({ run: 'nobody' }), /No session/);
});

test('a run with no events has no turns', async () => {
  const l = await fresh();
  const { run } = await make(l, [{ op: 'create', ref: 'run', type: 'run', title: 'Quiet', props: { session_id: 's2' } }]);
  const answer = (await VIEWS.turns.run(kernelContext(l, 'query'), { run })) as { turns: unknown[]; more: number };
  assert.deepEqual(answer.turns, []);
  assert.equal(answer.more, 0);
});
