// A session that says nothing for the house style's quiet_end_after is ended for it, as its end hook would have
// ended it (ended_by "quiet"); one heard from again, by heartbeat or by a raw event, is not. An ended run's works_on
// is closed at the end, so a canvas of its task no longer draws it, and the log still says who worked on what.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QuietSessions } from '../src/session-quiet.ts';
import * as queryFlatPack from '../packs/query/kernel/query-flat.ts';
import * as sessionEventsPack from '../packs/sessions/kernel/session-events.ts';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import { agent, fresh, make } from './map.ts';
import { kernelContext, ownContext } from '../packs/loader/kernel/kernel-context.ts';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** A task and a session working on it, last heard from `minutes` ago. */
async function quietFor(l: Archipelago, minutes: number, session_id = 'q1') {
  const { task } = await make(l, [{ op: 'create', ref: 'task', type: 'task', title: 'Capture probe' }]);
  const { run } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ task, session_id, title: 'Quiet one' }));
  await l.db.query(`update entity set props = props || jsonb_build_object('last_seen', $2::text) where id = $1`, [run, ago(minutes)]);
  return { task, run };
}

const beside = async (l: Archipelago, task: string) => (await queryFlatPack.flatRead(kernelContext(l, 'query'), ({ filter: { find: [`id ${task}`], not: [] }, walk: { over: ['works_on'], steps: 1 } }))).items.map((i: { id: string }) => i.id);

test('a run quiet past quiet_end_after is ended, says why, and leaves its task\'s canvas', async () => {
  const l = await fresh();
  const { task, run } = await quietFor(l, 25 * 60);
  assert.ok((await beside(l, task)).includes(run), 'drawn beside its task while open');
  await new QuietSessions(l).tick();
  const ended = (await l.entity(run))!;
  assert.equal(ended.is_open, false);
  assert.equal(ended.props.ended_by, 'quiet');
  assert.match(ended.body, /Not heard from for over 24 hours/);
  assert.ok(!(await beside(l, task)).includes(run), 'an ended run is not drawn beside its task');
  const { rows } = await l.db.query(`select 1 from relation where type = 'works_on' and from_id = $1 and to_id = $2 and valid_to is not null`, [run, task]);
  assert.equal(rows.length, 1, 'the link is closed, not forgotten: who worked on what is still read');
});

test('a run quiet for less is flagged, not ended', async () => {
  const l = await fresh();
  const { run } = await quietFor(l, 60);
  await new QuietSessions(l).tick();
  const still = (await l.entity(run))!;
  assert.equal(still.is_open, true);
  assert.equal(still.props.stale_flagged, true);
});

test('a run heard from again by a raw event is not ended', async () => {
  const l = await fresh();
  const { run } = await quietFor(l, 25 * 60);
  assert.equal((await sessionEventsPack.takeEvents(kernelContext(l, 'sessions'), ({ session_id: 'q1', source: 'claude-code', events: [{ at: ago(1), kind: 'turn.start', turn: 't1', by: 'person' }] }))).kept, 1);
  await new QuietSessions(l).tick();
  const still = (await l.entity(run))!;
  assert.equal(still.is_open, true);
  assert.notEqual(still.props.stale_flagged, true, 'nor flagged: it is not quiet');
});

test('the owner\'s style sets how long', async () => {
  const l = await fresh();
  await make(l, [{ op: 'create', ref: 's', type: 'style', title: 'Quicker', props: { numbers: { quiet_end_after: 90 } } }]);
  const { run } = await quietFor(l, 120);
  await new QuietSessions(l).tick();
  assert.equal((await l.entity(run))!.props.ended_by, 'quiet');
});
