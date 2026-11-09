// A held change decided by a person reaches the agent that asked: what it makes private stays private to whom it was
// held for, not to whoever approved it, and the approval or rejection is news to watch and the prompt hook.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agent, fresh, human, make } from './map.ts';
import { callTool, describeChanges, humanChanges, latestSeq } from '../src/tools.ts';

test('an approved private create is the proposer\'s to see, not the approver\'s alone', async () => {
  const l = await fresh();
  const { me } = await make(l, [{ op: 'create', ref: 'me', type: 'person', title: 'Owner' }]);
  // An agent tied to nobody proposes; the owner, who sees their own private items, approves.
  const asks = l.as(''), owner = l.as(me);
  const held = (await asks.change(agent, { reason: 'A private note', hold: true, ops: [{ op: 'create', ref: 'n', type: 'task', title: 'Held and private', visibility: 'private' }] })) as { status: string; proposal: string; would_make: Record<string, string> };
  assert.equal(held.status, 'proposed');
  const made = (await owner.decide(human, { proposal: held.proposal, approve: true })) as { created: Record<string, string> };
  const id = made.created.n;
  assert.equal(id, held.would_make.n, 'it makes what it showed');
  const seen = await asks.entity(id);
  assert.ok(seen, 'the agent that asked sees what was approved');
  assert.equal(seen.private_to, null, 'private to whom it was held for (nobody), as when it was held');

  // Held by a person's agent and approved by that person: private to them, as before.
  const mine = (await owner.change(agent, { reason: 'Mine', hold: true, ops: [{ op: 'create', ref: 'm', type: 'task', title: 'Mine alone', visibility: 'private' }] })) as { proposal: string };
  const kept = ((await owner.decide(human, { proposal: mine.proposal, approve: true })) as { created: Record<string, string> }).created.m;
  assert.equal((await owner.entity(kept))?.private_to, me);
  assert.equal(await asks.entity(kept), undefined);
});

test('an approval and a rejection reach watch and the prompt hook', async () => {
  const l = await fresh();
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Watched' }]);
  const from = await latestSeq(l);
  const yes = (await l.change(agent, { reason: 'Start it', hold: true, ops: [{ op: 'update', id: t, status: 'doing' }] })) as { proposal: string };
  const no = (await l.change(agent, { reason: 'Rename it', hold: true, ops: [{ op: 'update', id: t, title: 'Renamed' }] })) as { proposal: string };
  assert.deepEqual(await humanChanges(l, from), [], 'held is not news');
  await l.decide(human, { proposal: yes.proposal, approve: true });
  await l.decide(human, { proposal: no.proposal, approve: false, note: 'Keep the name' });

  const heard = await humanChanges(l, from);
  assert.deepEqual(heard.map((c) => [c.action, c.actor, c.decided?.outcome, c.decided?.proposal]), [
    ['entity.update', 'human:test', 'approved', yes.proposal],
    ['proposal.reject', 'human:test', 'rejected', no.proposal],
  ]);
  const said = describeChanges(heard);
  assert.match(said, /approved agent:test's held change: entity.update task "Watched"/);
  assert.match(said, new RegExp(`rejected agent:test's held change ${no.proposal} \\[Keep the name\\]`));

  // watch answers with both, and its cursor moves past them.
  const watched = (await callTool(l, agent, 'query', { name: 'watch', params: { after: from } })) as { latest: number; changes: unknown[]; counts?: Record<string, number> };
  assert.deepEqual(watched.counts ?? Object.fromEntries((watched.changes as { action: string }[]).map((c) => [c.action, 1])), { 'entity.update': 1, 'proposal.reject': 1 });
  assert.deepEqual(await humanChanges(l, watched.latest), []);
});
