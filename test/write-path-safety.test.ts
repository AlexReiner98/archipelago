// Parallel sessions that cannot collide, on the write path: a change sent again with its key applies once (task
// e_x265z5tk).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Actor, Archipelago } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { fresh } from './map.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const agent: Actor = { kind: 'agent', name: 'test' };
type Answer = Record<string, any>;

const count = async (l: Archipelago, title: string) => (await l.db.query<{ n: number }>(`select count(*)::int as n from entity where title = $1`, [title])).rows[0].n;

test('a change sent again with its key is answered with the first, applied or held, and applies once', async () => {
  const l = await fresh();
  await callTool(l, owner, 'workspace_set', { agent_changes: 'apply' });
  const send = () => callTool(l, agent, 'change', { reason: 'test', key: 'k-1', ops: [{ op: 'create', type: 'task', title: 'Once only' }] }) as Promise<Answer>;
  const first = await send();
  assert.equal(first.status, 'applied');
  const again = await send();
  assert.deepEqual([again.status, again.again, again.changeset], ['applied', true, first.changeset]);
  assert.match(again.note, /nothing was applied again/);
  assert.equal(await count(l, 'Once only'), 1);

  // Two at once: the second waits for the first, then finds it.
  const both = await Promise.all([0, 1].map(() => callTool(l, agent, 'change', { reason: 'test', key: 'k-2', ops: [{ op: 'create', type: 'task', title: 'Twice at once' }] }) as Promise<Answer>));
  assert.equal(new Set(both.map((b) => b.changeset)).size, 1);
  assert.equal(await count(l, 'Twice at once'), 1);

  // Another key, or none, is another change.
  await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Once only' }] });
  assert.equal(await count(l, 'Once only'), 2);

  await callTool(l, owner, 'workspace_set', { agent_changes: 'hold' });
  const held = (await callTool(l, agent, 'change', { reason: 'test', key: 'k-3', ops: [{ op: 'create', type: 'task', title: 'Held once' }] })) as Answer;
  assert.equal(held.status, 'proposed');
  const heldAgain = (await callTool(l, agent, 'change', { reason: 'test', key: 'k-3', ops: [{ op: 'create', type: 'task', title: 'Held once' }] })) as Answer;
  assert.deepEqual([heldAgain.status, heldAgain.again, heldAgain.proposal, heldAgain.proposal_status], ['proposed', true, held.proposal, 'pending']);
  const { rows } = await l.db.query<{ n: number }>(`select count(*)::int as n from proposal where status = 'pending'`);
  assert.equal(rows[0].n, 1);
});
