import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serve } from './serve.ts';

test('a new workspace starts on islands, with one island speaking core, so a first change has somewhere to go', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const owner = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme', email: 'owner@acme.test' })).result.owner_token as string;
  assert.equal((await call('/api/workspace_info', owner)).result.islands, true);
  const islands = (await call('/api/search', owner, { type: 'island' })).result as { id: string; title: string; props: { pack: string } }[];
  assert.deepEqual(islands.map((i) => [i.title, i.props.pack]), [['Acme', 'core']]);

  // An agent's first change names no island, and lands on the only one.
  const made = await call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'task', title: 'First' }] });
  const task = (await call('/api/get', owner, { id: made.result.created.t })).result.entity;
  assert.equal(task.props.island, islands[0].id);

  // With two islands it fits, it is asked where, and told which.
  await call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', type: 'island', title: 'Second', props: { pack: 'core' } }] });
  const refused = await call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Nowhere' }] });
  assert.ok(refused.error.includes(`such as ${islands[0].id} (Acme, core), `) && refused.error.includes('(Second, core)'), refused.error);
});
