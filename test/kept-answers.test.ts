// Answers kept until the map moves (task e_unbw4gtp, packs/loader/kernel/kept.ts): a read a pack marks kept is asked
// once while the map stands where it stood, by the same reader with the same input; anything written that it may
// depend on (a change, a session's bookkeeping, what a session touched) has it asked again at once; and what is kept
// for one reader is never given to another.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callAs } from '../packs/loader/kernel/kernel-context.ts';
import { keptAnswer, keptCount, MOST } from '../packs/loader/kernel/kept.ts';
import { ownContext } from '../packs/loader/kernel/kernel-context.ts';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { addTouched } from '../packs/sessions/kernel/touched.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { type Actor } from '../packs/write/kernel/pelago.ts';
import { serverTiming, timed, timing } from '../src/timing.ts';
import { fresh, human, make } from './map.ts';

const agent: Actor = { kind: 'agent', name: 'test' };

/** A read with the statements it asked and what Server-Timing says of what was kept. */
const asked = <T>(fn: () => Promise<T>) =>
  timed(async () => {
    const answer = await fn();
    const t = timing()!;
    return { answer, statements: t.statements, kept: /kept;desc="(\d+) of (\d+)/.exec(serverTiming(t))?.slice(1).map(Number) };
  });

type Frontier = { items: { id: string; title: string }[] };
const titles = (f: Frontier) => f.items.map((i) => i.title).sort();

test('the frontier is read once while the map stands still, and again as soon as it moves', async () => {
  const l = await fresh();
  await callTool(l, human, 'init', { name: 'Alex' });
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  const sessions = ownContext(l, 'sessions');
  const run = (await sessionsPack.sessionStart(sessions, agent as sessionsPack.Actor, { session_id: 'one', cwd: '/srv/app' })).run;
  await l.change(agent, { run, reason: 'Plan', ops: [{ op: 'create', type: 'task', title: 'Login form' }] });

  const frontier = () => callAs<Frontier>(l, 'answer.frontier', { limit: 50, said: true });
  const first = await asked(frontier);
  assert.deepEqual(titles(first.answer), ['Login form']);
  assert.equal(first.kept?.[0], 0, 'asked once: nothing was kept yet');
  const again = await asked(frontier);
  assert.deepEqual(again.answer, first.answer, 'the same answer');
  assert.deepEqual(again.kept, [1, 1], 'given as kept');
  assert.equal(again.statements, 1, `only where the map stands is read (${again.statements} statements, ${first.statements} the first time)`);
  // Each asker is given its own copy: what one does to it never reaches the next.
  again.answer.items.length = 0;
  assert.deepEqual(titles((await asked(frontier)).answer), ['Login form']);

  // A change moves the map: the next read sees it.
  await l.change(agent, { run, reason: 'More', ops: [{ op: 'create', type: 'task', title: 'User table' }] });
  const changed = await asked(frontier);
  assert.equal(changed.kept?.[0], 0, 'asked again once the map moved');
  assert.deepEqual(titles(changed.answer), ['Login form', 'User table']);

  // A session's bookkeeping moves it too (the sessions stream): a second session started is a run the frontier reads.
  const before = (await asked(frontier)).kept;
  assert.deepEqual(before, [1, 1]);
  const other = (await sessionsPack.sessionStart(sessions, agent as sessionsPack.Actor, { session_id: 'two', cwd: '/srv/app' })).run;
  assert.equal((await asked(frontier)).kept?.[0], 0, 'a session started moves the map');

  // And so does what a session touched, which lives in no stream (the transient store).
  const { seen } = await make(l, [{ op: 'create', ref: 'seen', type: 'task', title: 'Looked at, never changed' }]);
  assert.equal((await asked(frontier)).kept?.[0], 0);
  assert.deepEqual((await asked(frontier)).kept, [1, 1]);
  await addTouched(sessions, other, [seen]);
  const touched = await asked(frontier);
  assert.equal(touched.kept?.[0], 0, 'a touch moves the map');
  assert.ok(titles(touched.answer).includes('Looked at, never changed'), 'and the frontier finds what was touched');
});

test('what is kept for one reader is never given to another', async () => {
  const l = await fresh();
  await callTool(l, human, 'init', { name: 'Alex' });
  const { bo } = await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo', visibility: 'shared' }]);
  const asBo = l.as(bo);
  await asBo.change({ kind: 'human', name: 'bo', person: bo }, { reason: 'Mine', ops: [{ op: 'create', type: 'lens', title: 'Bo only', visibility: 'private', props: { filter: { find: ['type task'] } } }] });
  type Saved = { pictures: { title: string }[] };
  const views = (who: typeof l) => asked(() => callAs<Saved>(who, 'answer.saved_views', { limit: 100 }));
  const named = (s: Saved) => s.pictures.map((p) => p.title);

  const bos = await views(asBo);
  assert.ok(named(bos.answer).includes('Bo only'), 'Bo sees his own view');
  assert.deepEqual((await views(asBo)).kept, [1, 1], 'and is given it as kept');
  // Another person, with the same input, at the same place on the map: read for them, never Bo's.
  const someone = await views(l.as('e_someone0'));
  assert.deepEqual(someone.kept, [0, 1], 'nothing is kept for them yet');
  assert.ok(!named(someone.answer).includes('Bo only'), "nor do they see Bo's view");
  // Bo as an admin, or as one who only reads, is another reader too: what is read differs by the role.
  assert.deepEqual((await views(l.as(bo, true))).kept, [0, 1]);
  assert.deepEqual((await views(l.as(bo, false, true))).kept, [0, 1]);
  // Anyone with no login is never kept for.
  const anyone = l.forAnyone();
  await keptAnswer(anyone, 'probe', {}, async () => 1);
  assert.deepEqual((await asked(() => keptAnswer(anyone, 'probe', {}, async () => 1))).kept, [0, 1]);
});

test('what is kept is bounded', async () => {
  const l = await fresh();
  for (let i = 0; i < MOST + 20; i++) await keptAnswer(l, 'probe', { i }, async () => i);
  assert.equal(keptCount(l), MOST, `at most ${MOST} answers a database`);
  // The least lately asked went first: the newest are still kept.
  assert.deepEqual((await asked(() => keptAnswer(l, 'probe', { i: MOST + 19 }, async () => -1))).answer, MOST + 19);
  assert.deepEqual((await asked(() => keptAnswer(l, 'probe', { i: 0 }, async () => -1))).answer, -1);
});
