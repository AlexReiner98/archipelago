// The whole map as a file: the owner downloads it by a link good once; an agent only once the owner allows it.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parseBackup, restore } from '../src/backup.ts';
import { takeBackup } from '../src/backup-tools.ts';
import { openDb } from '../src/db.ts';
import { createShare } from '../src/documents.ts';
import { configureOutbox } from '../src/outbox.ts';
import { hostFor } from '../src/packtools.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const member: Actor = { kind: 'human', name: 'member' };
const agent: Actor = { kind: 'agent', name: 'test' };

const registries: Registry[] = [];
after(() => registries.forEach((r) => hostFor(r).stop()));

async function map() {
  const reg = new Registry(join(import.meta.dirname, '..', 'packs'));
  registries.push(reg);
  return new Archipelago(await openDb(), reg);
}

type Made = { path: string; rows: number };

test('the owner downloads the whole map by a link that works once', async () => {
  const l = await map();
  await l.change(owner, { reason: 'test', ops: [{ op: 'create', type: 'work.task', title: 'Kept in the file' }] });
  const made = (await callTool(l, owner, 'backup_download', {})) as Made;
  const key = made.path.replace('/backup-file/', '');
  const file = takeBackup(key)!;
  assert.ok(parseBackup(file.file).tables.entity.some((e) => e.title === 'Kept in the file'));
  assert.equal(takeBackup(key), undefined, 'good once');
  await assert.rejects(callTool(l, member, 'backup_download', {}), /Only a workspace admin/);
});

test('an agent downloads a backup only once the owner allows it', async () => {
  const l = await map();
  await assert.rejects(callTool(l, agent, 'backup_download', {}), /the owner allows it on the Workspace page/);
  await callTool(l, owner, 'workspace_set', { agent_backups: true });
  assert.equal(((await callTool(l, owner, 'workspace_info', {})) as { agent_backups: boolean }).agent_backups, true);
  const made = (await callTool(l, agent, 'backup_download', {})) as Made;
  assert.ok(takeBackup(made.path.replace('/backup-file/', '')));
  const logged = (await l.db.query<{ actor: string }>(`select actor from event where action = 'workspace.backup_download'`)).rows;
  assert.equal(logged.length, 1, 'the owner can see that an agent took one');
});

test("an agent's own view of the map reads whether the owner allows it a backup", async () => {
  const whole = await map();
  configureOutbox(async () => whole);
  await callTool(whole.as('e_owner', true), owner, 'workspace_set', { agent_backups: true });
  const made = (await callTool(whole.as('e_agentx'), agent, 'backup_download', {})) as Made;
  assert.ok(takeBackup(made.path.replace('/backup-file/', '')), 'a member reads the setting, as an agent token does');
});
test('a link given to a document is in the backup, and works again where the backup is restored', async () => {
  const l = await map();
  const made = await l.change(owner, { reason: 'test', ops: [{ op: 'create', type: 'work.document', title: 'Shared plan' }] });
  const doc = Object.values((made as { created: Record<string, string> }).created)[0];
  await createShare(l, owner, doc);
  const file = takeBackup(((await callTool(l, owner, 'backup_download', {})) as Made).path.replace('/backup-file/', ''))!;
  const there = await openDb();
  assert.equal((await restore(there, parseBackup(file.file))).share, 1);
  assert.deepEqual((await there.query<{ entity_id: string }>(`select entity_id from share`)).rows, [{ entity_id: doc }]);
});
