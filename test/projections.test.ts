// The projections of the log (docs/log.md, section 7): the tables every page reads are made from the log's facts in
// the append's transaction, the activity log is read from the log, and the review queue from the pending stream.
// The proof: every projection made again from the log alone, in an empty map, is the live one, row for row.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agent, fresh, human, make, replayed } from './map.ts';
import { callTool, humanChanges, latestSeq } from '../src/tools.ts';
import { FACT_ACTIONS, readEvents } from '../src/eventlog.ts';
import { undo } from '../src/undo.ts';

test('every projection made again from the log is the live one', async () => {
  const l = await fresh();
  const me = (await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }])).me;
  const made = await make(l, [
    { op: 'create', ref: 'repo', type: 'repo', title: 'Apex repo', props: { path: 'C:\\code\\Apex' } },
    { op: 'create', ref: 'p', type: 'project', title: 'Projections' },
    { op: 'create', ref: 't', type: 'task', title: 'Project the facts', owner: me },
    { op: 'create', ref: 'u', type: 'task', title: 'Read events from the log' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Keep the event table?' },
    { op: 'link', type: 'lives_in', from: 'p', to: 'repo' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'link', type: 'part_of', from: 'u', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'u', to: 't' },
    { op: 'link', type: 'depends_on', from: 'u', to: 'q' },
  ]);
  // Two ops on one item in one change: the second is planned on what the first did.
  await make(l, [{ op: 'update', id: made.t, status: 'doing' }, { op: 'update', id: made.t, append: 'Op by op.' }, { op: 'update', id: made.t, append: 'In order.' }]);
  assert.equal((await l.entity(made.t))!.body, 'Op by op.\n\nIn order.');
  const twice = await make(l, [{ op: 'create', ref: 's', type: 'task', title: 'Cited twice' }, { op: 'link', type: 'part_of', from: 's', to: made.p }, { op: 'link', type: 'part_of', from: 's', to: made.p }]);
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
  assert.deepEqual(replay.closure, live.closure, 'what is inside what, all the way down');
  assert.deepEqual(replay.mentions, live.mentions, 'what names what');
});

test('what is inside what, all the way down, follows every link made, ended and moved, and is read by index', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'top', type: 'project', title: 'Top' },
    { op: 'create', ref: 'mid', type: 'project', title: 'Middle' },
    { op: 'create', ref: 'other', type: 'project', title: 'Other' },
    { op: 'create', ref: 'a', type: 'task', title: 'A', body: 'See {mid} first.' },
    { op: 'create', ref: 'b', type: 'task', title: 'B' },
    { op: 'link', type: 'part_of', from: 'mid', to: 'top' },
    { op: 'link', type: 'part_of', from: 'a', to: 'mid' },
    { op: 'link', type: 'part_of', from: 'b', to: 'a' },
  ]);
  const above = async (id: string) => (await l.db.query<{ ancestor: string }>(`select ancestor from part_closure where descendant = $1 order by ancestor`, [id])).rows.map((r) => r.ancestor);
  assert.deepEqual(await above(made.b), [made.a, made.mid, made.top].sort(), 'held at every depth');
  assert.deepEqual((await l.get(made.mid)).mentioned_in.map((m) => m.id), [made.a], 'what names it, by the mention projection');
  // Moved: the middle leaves the top for another, and everything below it goes with it.
  const link = ((await l.get(made.mid)).outgoing as { type: string; id: string; relation: string }[]).find((o) => o.type === 'part_of')!;
  await make(l, [{ op: 'unlink', relation: link.relation }, { op: 'link', type: 'part_of', from: made.mid, to: made.other }]);
  assert.deepEqual(await above(made.b), [made.a, made.mid, made.other].sort());
  // Held twice, it keeps the other way up when one ends.
  await make(l, [{ op: 'link', type: 'part_of', from: made.a, to: made.top }]);
  const twice = ((await l.get(made.a)).outgoing as { type: string; id: string; relation: string }[]).find((o) => o.type === 'part_of' && o.id === made.mid)!;
  await make(l, [{ op: 'unlink', relation: twice.relation }]);
  assert.deepEqual(await above(made.b), [made.a, made.top].sort());
  const { live, replay } = await replayed(l);
  assert.deepEqual(replay.closure, live.closure);
});

test('what a change set did is read from the log, not kept a second time as events', async () => {
  const l = await fresh();
  const start = await latestSeq(l);
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'History' },
    { op: 'create', ref: 't', type: 'task', title: 'Read it back' },
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
  assert.deepEqual((await humanChanges(l, start)).map((c) => c.action), ['entity.create', 'entity.create', 'relation.link', 'entity.update']);

  // An event about what a viewer may not see is not theirs to read.
  const me = (await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }])).me;
  const hidden = (await l.as(me).change(human, { reason: 'Mine', ops: [{ op: 'create', ref: 'h', type: 'task', title: 'Private', visibility: 'private' }] })) as { created: Record<string, string> };
  assert.ok((await readEvents(l.as(me).db, { target: hidden.created.h })).length === 1);
  assert.deepEqual(await readEvents(l.as('e_someone').db, { target: hidden.created.h }), []);

  // changed_since counts what the log says happened.
  const since = (await callTool(l, human, 'view', { name: 'changed_since', params: { since: new Date(Date.now() - 60_000).toISOString() } })) as { counts: Record<string, number> };
  assert.equal(since.counts['entity.create'], 4);
  assert.equal(since.counts['entity.update'], 1);
});
