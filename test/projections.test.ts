// The projections of the log (docs/log.md, section 7): the tables every page reads are made from the log's facts in
// the append's transaction, the activity log is read from the log, and the review queue from the pending stream.
// The proof: every projection made again from the log alone, in an empty map, is the live one, row for row.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agent, fresh, human, make, replayed } from './map.ts';
import { callTool, humanChanges, latestSeq } from '../src/tools.ts';
import { FACT_ACTIONS, readEvents } from '../src/eventlog.ts';
import { touched } from '../src/touched.ts';
import { undo } from '../src/undo.ts';

test('every projection made again from the log is the live one', async () => {
  const l = await fresh();
  const me = (await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }])).me;
  const made = await make(l, [
    { op: 'create', ref: 'repo', type: 'software.repo', title: 'Apex repo', props: { path: 'C:\\code\\Apex' } },
    { op: 'create', ref: 'p', type: 'work.project', title: 'Projections' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Project the facts', owner: me },
    { op: 'create', ref: 'u', type: 'work.task', title: 'Read events from the log' },
    { op: 'create', ref: 'q', type: 'work.decision', title: 'Keep the event table?' },
    { op: 'link', type: 'software.lives_in', from: 'p', to: 'repo' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'link', type: 'part_of', from: 'u', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'u', to: 't' },
    { op: 'link', type: 'depends_on', from: 'u', to: 'q' },
  ]);
  // Two ops on one item in one change: the second is planned on what the first did.
  await make(l, [{ op: 'update', id: made.t, status: 'doing' }, { op: 'update', id: made.t, append: 'Op by op.' }, { op: 'update', id: made.t, append: 'In order.' }]);
  assert.equal((await l.entity(made.t))!.body, 'Op by op.\n\nIn order.');
  const twice = await make(l, [{ op: 'create', ref: 's', type: 'work.task', title: 'Cited twice' }, { op: 'link', type: 'part_of', from: 's', to: made.p }, { op: 'link', type: 'part_of', from: 's', to: made.p }]);
  assert.equal((await l.get(twice.s)).outgoing.length, 1, 'a link made twice in one change is made once');

  // A session at work, through the tools, as an agent does it.
  const run = (await callTool(l, agent, 'session_start', { task: made.t, title: 'Projections', cwd: 'C:\\code\\Apex' })) as { run: string };
  await callTool(l, agent, 'session_update', { run: run.run, note: 'Projector written' });
  const started = (await callTool(l, agent, 'change', { reason: 'Started', ops: [{ op: 'update', id: made.u, status: 'doing' }] })) as { proposal: string };

  // Held, approved, declined and made moot; an undo; a merge; an archive and a restore.
  const asked = (await l.change(agent, { reason: 'Answer it', ops: [{ op: 'update', id: made.q, status: 'decided', props: { outcome: 'No', rationale: 'The log holds it' } }] })) as { proposal: string };
  await l.decide(human, { proposal: asked.proposal, approve: true, note: 'Yes' });
  const no = (await l.change(agent, { reason: 'Rename', ops: [{ op: 'update', id: made.p, title: 'Elsewhere' }] })) as { proposal: string };
  await l.decide(human, { proposal: no.proposal, approve: false, note: 'Keep it' });
  const moot = (await l.change(agent, { reason: 'Done', ops: [{ op: 'update', id: made.u, status: 'done' }] })) as { proposal: string };
  const open = (await l.change(agent, { reason: 'Later', ops: [{ op: 'update', id: made.p, props: { hub_at: 4 } }] })) as { proposal: string };
  await make(l, [{ op: 'update', id: made.u, status: 'done' }]);
  const edit = (await l.change(human, { reason: 'Reshape', ops: [{ op: 'update', id: twice.s, title: 'Cited once' }, { op: 'archive', id: twice.s }] })) as { changeset: string };
  await undo(l, human, { changeset: edit.changeset });
  await make(l, [{ op: 'merge', keep: made.t, drop: twice.s }]);

  const queue = await l.proposals({ status: 'pending' });
  assert.deepEqual(queue.map((p) => p.id), [started.proposal, open.proposal], 'what is pending: the records nothing has decided');
  const decided = Object.fromEntries((await Promise.all(['approved', 'rejected', 'superseded'].map((status) => l.proposals({ status })))).flat().map((p) => [p.id, [p.status, p.note]]));
  assert.deepEqual(decided[asked.proposal], ['approved', 'Yes']);
  assert.deepEqual(decided[no.proposal], ['rejected', 'Keep it']);
  assert.equal(decided[moot.proposal][0], 'superseded');

  const { live, replay } = await replayed(l);
  assert.deepEqual([live.items.length > 6, live.links.length > 6, live.queue.length], [true, true, 5]);
  assert.deepEqual(replay.items, live.items, 'every item, row for row');
  assert.deepEqual(replay.links, live.links, 'every link, row for row');
  assert.deepEqual(replay.queue, live.queue, 'every held change, and what became of it');
});

test('what a change set did is read from the log, not kept a second time as events', async () => {
  const l = await fresh();
  const start = await latestSeq(l);
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'History' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Read it back' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
  ]);
  await l.change(human, { reason: 'Started', ops: [{ op: 'update', id: made.t, status: 'doing', title: 'Read it back from the log' }] });
  const { rows } = await l.db.query(`select action from event where action = any($1::text[])`, [FACT_ACTIONS]);
  assert.deepEqual(rows, [], 'the event table keeps no change set');

  // An item's history: its making, its link, its edit with the values before, its title as it was then.
  const history = (await l.get(made.t)).recent_events;
  assert.deepEqual(history.map((e) => e.action), ['entity.update', 'relation.link', 'entity.create']);
  assert.deepEqual(history[0].detail.changes, { title: { from: 'Read it back', to: 'Read it back from the log' }, status: { from: 'todo', to: 'doing' } });
  assert.equal(history[2].detail.title, 'Read it back', 'the title as it was when it was made');
  assert.deepEqual([history[1].detail.type, history[1].detail.to], ['part_of', made.p]);

  // Read back a page at a time, nothing twice and nothing missed; forward from a cursor too.
  const everything = await readEvents(l.db, {});
  const paged = [...(await readEvents(l.db, { limit: 2 })), ...(await readEvents(l.db, { limit: 50, before: (await readEvents(l.db, { limit: 2 })).at(-1)!.seq }))];
  assert.deepEqual(paged.map((e) => e.seq), everything.map((e) => e.seq));
  assert.equal(new Set(everything.map((e) => e.seq)).size, everything.length, 'each event its own number');
  const after = await touched(l.db, start);
  assert.deepEqual(new Set(after.ids), new Set([made.p, made.t]));
  assert.equal(after.made, 2);
  assert.deepEqual((await humanChanges(l, start)).map((c) => c.action), ['entity.create', 'entity.create', 'relation.link', 'entity.update']);

  // An event about what a viewer may not see is not theirs to read.
  const me = (await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }])).me;
  const hidden = (await l.as(me).change(human, { reason: 'Mine', ops: [{ op: 'create', ref: 'h', type: 'work.task', title: 'Private', visibility: 'private' }] })) as { created: Record<string, string> };
  assert.ok((await readEvents(l.as(me).db, { target: hidden.created.h })).length === 1);
  assert.deepEqual(await readEvents(l.as('e_someone').db, { target: hidden.created.h }), []);

  // changed_since counts what the log says happened.
  const since = (await callTool(l, human, 'view', { name: 'changed_since', params: { since: new Date(Date.now() - 60_000).toISOString() } })) as { counts: Record<string, number> };
  assert.equal(since.counts['entity.create'], 4);
  assert.equal(since.counts['entity.update'], 1);
});
