// An agent publishes a document only where the workspace's owner allows it, each publish logged with its authority;
// the allowance is a human admin's to give, and taking a document down stays a human's.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { hostFor } from '../src/packtools.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const member: Actor = { kind: 'human', name: 'member' };
const agent: Actor = { kind: 'agent', name: 'test', admin: true };

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

async function withDocument() {
  const reg = new Registry(join(import.meta.dirname, '..', 'packs'));
  registries.push(reg);
  const l = new Archipelago(await openDb(), reg);
  const made = await l.change(owner, { reason: 'test', ops: [{ op: 'create', ref: 'd', type: 'work.document', title: 'Landing', visibility: 'shared', body: 'What it is, in a line.' }] });
  return { l, doc: (made as { created: Record<string, string> }).created.d };
}

test('an agent may not publish until the owner allows it', async () => {
  const { l, doc } = await withDocument();
  await assert.rejects(callTool(l, agent, 'publish', { id: doc }), /Publishing is the owner’s here/);
  await assert.rejects(callTool(l, agent, 'publish_all', { within: doc }), /Publishing is the owner’s here/);
  assert.equal((await l.entity(doc))!.visibility, 'shared', 'nothing was made public');
  assert.equal((await l.db.query(`select 1 from published`)).rows.length, 0);
});

test('with the owner’s allowance an agent publishes, and the log keeps on whose authority', async () => {
  const { l, doc } = await withDocument();
  await callTool(l, owner, 'workspace_set', { agent_publish: true });
  assert.equal(((await callTool(l, owner, 'workspace_info', {})) as { agent_publish: boolean }).agent_publish, true);
  const basis = 'Owner in chat, 21 Oct: publish the landing page';
  assert.equal(((await callTool(l, agent, 'publish', { id: doc, authority: { of: 'human', basis } })) as { published: string }).published, doc);
  assert.equal((await l.entity(doc))!.visibility, 'public');
  const { rows } = await l.db.query<{ actor: string; detail: { authority: Record<string, string> } }>(`select actor, detail from event where action = 'document.publish'`);
  assert.equal(rows.length, 1);
  assert.match(rows[0].actor, /^agent:/);
  assert.deepEqual(rows[0].detail.authority, { of: 'human', basis, stated_by: rows[0].actor });
  await assert.rejects(callTool(l, agent, 'publish', { id: doc, authority: { of: 'human' } }), /say what they said and where/);
  // Taking it down stays a human's.
  await assert.rejects(callTool(l, agent, 'unpublish', { id: doc }), /for humans only/);
  // The owner takes the allowance back, and the agent is refused again.
  await callTool(l, owner, 'workspace_set', { agent_publish: false });
  await assert.rejects(callTool(l, agent, 'publish', { id: doc }), /Publishing is the owner’s here/);
});

test('only a human admin turns agent publishing on, and the database refuses anyone else', async () => {
  const { l } = await withDocument();
  await assert.rejects(callTool(l, agent, 'workspace_set', { agent_publish: true }), /for humans only/);
  await assert.rejects(callTool(l, member, 'workspace_set', { agent_publish: true }), /Only a workspace admin/);
  // A token's own view of the map reads the setting but cannot write it.
  const scoped = l.as('e_agentx');
  await assert.rejects(scoped.db.query(`insert into setting (key, value) values ('agent_publish', 'true'::jsonb)`));
  assert.equal(await scoped.setting('agent_publish'), undefined);
  await callTool(l, owner, 'workspace_set', { agent_publish: true });
  assert.equal(await scoped.setting('agent_publish'), true, 'a member reads it, as an agent token does');
});
