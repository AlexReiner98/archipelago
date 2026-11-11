// A replay set worked out without the map (replay.js): the tasks a set takes and the held briefs it makes, then the
// sessions a replay asks the kernel to start.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { freezeAnswer, replayAnswer, versionRefused } from './replay.js';

const NOW = '2026-11-11T12:00:00.000Z';
const done = (i: number) => ({ id: `e_task000${i}`, task: { id: `e_task000${i}`, title: `Task ${i}`, is_open: false }, brief: { task: { id: `e_task000${i}`, title: `Task ${i}` }, repo: { title: 'Repo', path: '/repo' }, text: `# Task ${i}` } });

test('a new set holds five to ten finished tasks, each brief an item part of it, in order', () => {
  const five = [0, 1, 2, 3, 4].map(done);
  const made = freezeAnswer({ set: null, title: 'Spring set', held: [], asked: five, now: NOW });
  assert.equal(made.ops[0].type, 'replays.set');
  const briefs = made.ops.filter((o: { type: string }) => o.type === 'replays.brief');
  assert.deepEqual(briefs.map((b: { props: { order: number } }) => b.props.order), [0, 1, 2, 3, 4]);
  assert.deepEqual(briefs[2], { op: 'create', ref: 'b2', type: 'replays.brief', title: 'Task 2', body: '# Task 2', props: { task: 'e_task0002', repo: 'Repo', path: '/repo', frozen_at: NOW, order: 2 } });
  assert.ok(made.ops.some((o: { op: string; from: string; to: string }) => o.op === 'link' && o.from === 'b4' && o.to === 'set'));
  assert.deepEqual(made.answer, { set: '{set}', held: 5, added: five.map((f) => f.id) });

  assert.throws(() => freezeAnswer({ set: null, title: 'Short', held: [], asked: five.slice(0, 4), now: NOW }), /5 to 10 tasks; this one would hold 4/);
  assert.throws(() => freezeAnswer({ set: null, title: '', held: [], asked: five, now: NOW }), /needs a title/);
  const open = { ...done(5), task: { ...done(5).task, is_open: true } };
  assert.throws(() => freezeAnswer({ set: null, title: 'x', held: [], asked: [...five.slice(0, 4), open], now: NOW }), /"Task 5" is not finished/);
  const nowhere = { ...done(6), brief: { ...done(6).brief, repo: undefined } };
  assert.throws(() => freezeAnswer({ set: null, title: 'x', held: [], asked: [...five.slice(0, 4), nowhere], now: NOW }), /nowhere to run it/);
});

test('a set added to keeps what it holds, and the new briefs follow on', () => {
  const held = [0, 1, 2, 3, 4].map((i) => ({ id: `e_brief00${i}`, props: { task: `e_task000${i}`, order: i } }));
  const made = freezeAnswer({ set: { id: 'e_set00001', title: 'Spring set' }, held, asked: [done(0), done(5)], now: NOW });
  assert.deepEqual(made.answer.added, ['e_task0005'], 'a task it holds keeps its brief');
  assert.deepEqual(made.ops.map((o: { op: string; props?: { order: number }; to?: string }) => o.props?.order ?? o.to), [5, 'e_set00001']);
});

test('a replay runs only under the version in force, and asks each held brief started again, naming the set and version', () => {
  const packs = [{ id: 'core', version: '0.1.0' }];
  assert.equal(versionRefused('core@0.1.0', packs), undefined);
  assert.match(versionRefused('core@0.2.0', packs), /runs core@0\.1\.0, not 0\.2\.0/);
  assert.match(versionRefused('core', packs), /<pack>@<version>/);
  assert.match(versionRefused('nope@1', packs), /No pack "nope"/);

  const set = { id: 'e_set00001', title: 'Spring set', is_open: true };
  const briefs = [4, 3, 2, 1, 0].map((i) => ({ id: `e_brief00${i}`, title: `Task ${i}`, body: `# Task ${i}`, props: { task: `e_task000${i}`, repo: 'Repo', path: '/repo', order: i } }));
  const asked = replayAnswer({ set, briefs, version: 'core@0.1.0', packs, mode: 'plan' });
  assert.deepEqual(asked.launches.map((x: { task: string }) => x.task), [0, 1, 2, 3, 4].map((i) => `e_task000${i}`), 'in the set’s order');
  assert.deepEqual(asked.launches[1], {
    task: 'e_task0001', mode: 'plan',
    brief: { task: { id: 'e_task0001', title: 'Task 1' }, repo: { title: 'Repo', path: '/repo' }, text: '# Task 1' },
    by: { id: 'e_set00001', name: 'Spring set (core@0.1.0)', version: 'core@0.1.0', task: 'e_task0001', brief: 'e_brief001' },
  });
  assert.throws(() => replayAnswer({ set, briefs: briefs.slice(0, 4), version: 'core@0.1.0', packs }), /holds 4 briefs/);
  assert.throws(() => replayAnswer({ set: { ...set, is_open: false }, briefs, version: 'core@0.1.0', packs }), /retired/);
});
