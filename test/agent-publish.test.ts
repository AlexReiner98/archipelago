// An agent publishes a document only where the workspace's owner allows it, each publish logged with its authority;
// the allowance is a human admin's to give, and taking a document down stays a human's.
import assert from 'node:assert/strict';
import { doneEvents } from '../packs/log/kernel/activity.ts';
import { after, test } from 'node:test';
import { openDb } from '../packs/database/kernel/db.ts';
import { migrate } from '../packs/database/kernel/migrate.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { Archipelago, type Actor } from '../packs/write/kernel/pelago.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import * as publishedPack from '../packs/publish/kernel/published.ts';
import { packsWith } from './map.ts';
import { OLD_EVENT } from './old-event.ts';
import { WORKSPACE_SHARE } from '../packs/database/kernel/schema.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const member: Actor = { kind: 'human', name: 'member' };
const agent: Actor = { kind: 'agent', name: 'test', admin: true };

// The repository's packs and a test pack whose writing can be published (test/packs/reader).
const PACKS = packsWith('reader');
const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

async function withDocument() {
  const reg = new Registry(PACKS);
  registries.push(reg);
  const db = await openDb();
  const l = new Archipelago(db, reg);
  const made = await l.change(owner, { reason: 'test', ops: [{ op: 'create', ref: 'd', type: 'writing', title: 'Landing', visibility: 'shared', body: 'What it is, in a line.' }] });
  return { l, db, doc: (made as { created: Record<string, string> }).created.d };
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
  const rows = (await doneEvents(l.db, { action: 'document.publish' }, 50)) as unknown as { actor: string; detail: { authority: Record<string, string> } }[];
  assert.equal(rows.length, 1);
  assert.match(rows[0].actor, /^agent:/);
  assert.deepEqual(rows[0].detail.authority, { of: 'human', basis, stated_by: rows[0].actor });
  await assert.rejects(callTool(l, agent, 'publish', { id: doc, authority: { of: 'human' } }), /say what they said and where/);
  // The same allowance lets it take a document down (core's agent_unpublish, lifted by agent_publish).
  assert.equal(((await callTool(l, agent, 'unpublish', { id: doc })) as { unpublished: string }).unpublished, doc);
  assert.equal((await l.db.query(`select 1 from published`)).rows.length, 0);
  await callTool(l, agent, 'publish', { id: doc, authority: { of: 'human', basis } });
  assert.equal((await publishedPack.unpublish(kernelContext(l, 'publish'), owner, doc)).unpublished, doc, 'the owner takes it down');
  assert.equal((await l.db.query(`select 1 from published`)).rows.length, 0);
  await callTool(l, agent, 'publish', { id: doc, authority: { of: 'human', basis } });
  // A token that may only propose is refused even so: publishing is never held, so it asks instead.
  await assert.rejects(callTool(l, { ...agent, may: 'propose' }, 'publish', { id: doc }), /may only propose/);
  await assert.rejects(callTool(l, { ...agent, may: 'propose' }, 'publish_all', { within: doc }), /may only propose/);
  // The owner takes the allowance back, and the agent is refused again: taking down too.
  await callTool(l, owner, 'workspace_set', { agent_publish: false });
  await assert.rejects(callTool(l, agent, 'publish', { id: doc }), /Publishing is the owner’s here/);
  await assert.rejects(publishedPack.unpublish(kernelContext(l, 'publish'), agent, doc), /Taking a document down is the owner’s/);
  assert.equal((await l.db.query(`select 1 from published`)).rows.length, 1, 'still published');
});

test('with holds off an agent publishes, shares and takes down at once, and each answer names the stakes', async () => {
  const { l, doc } = await withDocument();
  await callTool(l, owner, 'workspace_set', { holds_off: true });
  const published = (await callTool(l, agent, 'publish', { id: doc })) as { published: string; stakes: string[] };
  assert.equal(published.published, doc);
  assert.match(published.stakes[0], /"Landing" is public now, at \/p\/.+: anyone on the internet reads it/);
  assert.ok(published.stakes.includes('Published: anyone with the address can read it, now.'), 'core’s agent_publish says its stake');
  assert.match(published.stakes.at(-1)!, /unpublish takes it down/);
  const down = (await callTool(l, agent, 'unpublish', { id: doc })) as { unpublished: string; stakes: string[] };
  assert.deepEqual([down.unpublished, down.stakes], [doc, ['Taken down: whoever had the address can no longer read it.']]);
  const shared = (await callTool(l, agent, 'share_create', { id: doc })) as { shared: string; stakes: string[] };
  assert.equal(shared.shared, doc);
  assert.match(shared.stakes[0], /^Public now at .+: anyone on the internet can read it/);
  assert.ok(((await callTool(l, agent, 'share_revoke', { id: doc })) as { unshared: string }).unshared);
  // A person's own act says no stakes: they are what an agent is told.
  assert.equal(((await callTool(l, owner, 'publish', { id: doc })) as { stakes?: string[] }).stakes, undefined);
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

test('a database made before step 12 lets an agent read the allowance once it takes that step', async () => {
  const { l, db } = await withDocument();
  // As a database at step 11 is: the read rule of step 1, without the allowance in it, the event table step 34 drops,
  // and the share columns of step 7 that step 39 drops.
  await db.exec(`drop policy member_setting_read on setting;
    create policy member_setting_read on setting for select to pelago_member using (key in ('me', 'default_visibility', 'agent_changes', 'agent_backups'));
    delete from schema_version where version >= 12;
    ${OLD_EVENT}
    ${WORKSPACE_SHARE}`);
  await callTool(l, owner, 'workspace_set', { agent_publish: true });
  assert.equal(await l.as('e_agentx').setting('agent_publish'), undefined, 'hidden from a member before the step');
  await migrate(db, false);
  assert.equal(await l.as('e_agentx').setting('agent_publish'), true);
});
