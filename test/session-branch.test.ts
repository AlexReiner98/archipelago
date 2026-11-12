// A session says the branch it works on and is told, by the map's own answers, how to say in a commit that it
// finished its task: what the push reader and the GitHub pack read off a push.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, fresh, laneSetup } from './map.ts';
import { ownContext } from '../packs/loader/kernel/kernel-context.ts';

test('a session keeps its branch', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const started = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ task: made.offline, branch: 'claude/tests', session_id: 'b1' }));
  const branchOf = async () => (await l.entity(started.run))!.props.branch;
  assert.equal(await branchOf(), 'claude/tests');

  // Moving to another branch is kept, even said alone; a heartbeat that says nothing new changes nothing.
  await sessionsPack.sessionUpdate(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run: started.run, branch: 'claude/tests-2' }));
  assert.equal(await branchOf(), 'claude/tests-2');
  const count = async () => Number((await l.db.query<{ n: number }>(`select (select count(*) from log_op where stream = 'activity') + (select count(*) from log_entry) as n`)).rows[0].n);
  const events = await count();
  await sessionsPack.sessionUpdate(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run: started.run, branch: 'claude/tests-2' }));
  assert.equal(await count(), events, 'the same branch again is a heartbeat');

});

test('a pack finds the sessions on a branch and what they work on, through its reads', async () => {
  const { answerRead } = await import('../packs/surface/kernel/packreads.ts');
  const l = await fresh();
  const made = await laneSetup(l);
  await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ task: made.offline, branch: 'claude/tests' }));
  await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ task: made.live, branch: 'elsewhere' }));
  const runs = (await answerRead(l, { items: { type: 'run', where: { branch: 'claude/tests' } }, fields: ['branch'] })) as { id: string }[];
  assert.equal(runs.length, 1);
  const worked = (await answerRead(l, { related: runs[0].id, relation: 'works_on' })) as { id: string }[];
  assert.deepEqual(worked.map((t) => t.id), [made.offline]);
});
