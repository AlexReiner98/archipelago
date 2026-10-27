// A session says the branch it works on and is told, by the map's own answers, how to say in a commit that it
// finished its task: what the push reader and the GitHub pack read off a push.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionStart, sessionUpdate } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { agent, fresh, laneSetup } from './map.ts';

test('a session keeps its branch, and taking a task tells it how a commit closes that task', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const started = await sessionStart(l, agent, { task: made.offline, branch: 'claude/tests', session_id: 'b1' });
  assert.match(started.commit!, new RegExp(`end its message with the line "Closes: ${made.offline}"`));
  const branchOf = async () => (await l.entity(started.run))!.props.branch;
  assert.equal(await branchOf(), 'claude/tests');

  // Moving to another branch is kept, even said alone; a heartbeat that says nothing new changes nothing.
  await sessionUpdate(l, agent, { run: started.run, branch: 'claude/tests-2' });
  assert.equal(await branchOf(), 'claude/tests-2');
  const count = async () => Number((await l.db.query<{ n: number }>(`select (select count(*) from event) + (select count(*) from log_entry) as n`)).rows[0].n);
  const events = await count();
  await sessionUpdate(l, agent, { run: started.run, branch: 'claude/tests-2' });
  assert.equal(await count(), events, 'the same branch again is a heartbeat');

  // A task picked up later is answered the same way, and a session with no task is told nothing of it.
  assert.match((await sessionUpdate(l, agent, { run: started.run, task: made.gated })).commit!, new RegExp(`Closes: ${made.gated}`));
  assert.equal((await sessionStart(l, agent, { title: 'Looking around' })).commit, undefined);

  // A brief for a launched session says it too.
  const brief = (await callTool(l, agent, 'view', { name: 'brief', params: { task: made.offline } })) as { text: string };
  assert.match(brief.text, new RegExp(`with your git branch[\\s\\S]*Closes: ${made.offline}`));
});

test('a pack finds the sessions on a branch and what they work on, through its reads', async () => {
  const { answerRead } = await import('../src/packreads.ts');
  const l = await fresh();
  const made = await laneSetup(l);
  await sessionStart(l, agent, { task: made.offline, branch: 'claude/tests' });
  await sessionStart(l, agent, { task: made.live, branch: 'elsewhere' });
  const runs = (await answerRead(l, { items: { type: 'run', where: { branch: 'claude/tests' } }, fields: ['branch'] })) as { id: string }[];
  assert.equal(runs.length, 1);
  const worked = (await answerRead(l, { related: runs[0].id, relation: 'works_on' })) as { id: string }[];
  assert.deepEqual(worked.map((t) => t.id), [made.offline]);
});
