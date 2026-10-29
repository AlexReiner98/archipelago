// The whole map as a file: the owner downloads it by a link good once; an agent only once the owner allows it.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { dump, parseBackup, parseVault, readable, restore, restoreTo } from '../src/backup.ts';
import { dumpVault, rewrap } from '../src/vault.ts';
import { takeBackup } from '../src/backup-tools.ts';
import { openDb } from '../src/db.ts';
import { databaseFor, dropDatabaseFor } from '../src/pg.ts';
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
const takeFile = (found: { file: Buffer } | undefined) => found!.file;
/** The file a link gives, from the whole workspace's database, as the server's route takes it. */
const fetched = (l: Archipelago, made: Made) => takeBackup(l.db, made.path.split('/').at(-1)!);

test('the owner downloads the whole map by a link that works once', async () => {
  const l = await map();
  await l.change(owner, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Kept in the file' }] });
  const made = (await callTool(l, owner, 'backup_download', {})) as Made;
  assert.match(made.path, new RegExp(`^/backup-file/${l.workspace}/`), 'the link names its workspace, so any server can give it');
  const file = (await fetched(l, made))!;
  assert.ok((await readable(l.db, parseBackup(file.file))).tables.entity.some((e) => e.title === 'Kept in the file'));
  // Its keys come by a link of their own, wrapped under a key only the answer holds: opened with it, the copy reads anywhere.
  const sent = parseVault(takeFile(await takeBackup(l.db, (made as Made & { vault_path: string }).vault_path.split('/').at(-1)!)));
  const there = await openDb();
  await assert.rejects(restore(there, { ...parseBackup(file.file), vault: sent }), /give the backup of the key vault/, 'not without its key');
  await restore(there, { ...parseBackup(file.file), vault: rewrap(sent, Buffer.from((made as Made & { vault_key: string }).vault_key, 'base64url')) });
  assert.equal((await there.query<{ title: string }>(`select title from entity`)).rows[0].title, 'Kept in the file');
  assert.equal(await fetched(l, made), undefined, 'good once');
  await assert.rejects(callTool(l, member, 'backup_download', {}), /Only a workspace admin/);
});

test('an agent downloads a backup only once the owner allows it', async () => {
  const l = await map();
  await assert.rejects(callTool(l, agent, 'backup_download', {}), /the owner allows it on the Workspace page/);
  await callTool(l, owner, 'workspace_set', { agent_backups: true });
  assert.equal(((await callTool(l, owner, 'workspace_info', {})) as { agent_backups: boolean }).agent_backups, true);
  const made = (await callTool(l, agent, 'backup_download', {})) as Made;
  assert.ok(await fetched(l, made));
  const logged = (await l.db.query<{ actor: string }>(`select actor from event where action = 'workspace.backup_download'`)).rows;
  assert.equal(logged.length, 1, 'the owner can see that an agent took one');
});

test('an agent a member who is no admin made is refused the backup, and so is one that may only propose', async () => {
  const l = await map();
  await callTool(l, owner, 'workspace_set', { agent_backups: true });
  const made = await l.change(owner, { reason: 'test', ops: [{ op: 'create', ref: 'p', type: 'person', title: 'Pat', visibility: 'shared' }, { op: 'create', ref: 'a', type: 'person', title: 'Ada', visibility: 'shared' }] });
  const { p: pat, a: ada } = (made as { created: Record<string, string> }).created;
  await l.db.query(`insert into member (email, person_id, admin, added_by) values ('pat@example.com', $1, false, 'test'), ('ada@example.com', $2, true, 'test')`, [pat, ada]);
  await assert.rejects(callTool(l, { ...agent, person: pat }, 'backup_download', {}), /Only a workspace admin/);
  await assert.rejects(callTool(l, { ...agent, may: 'propose' }, 'backup_download', {}), /Only a workspace admin/);
  assert.ok(await fetched(l, (await callTool(l, { ...agent, person: ada }, 'backup_download', {})) as Made), 'an admin’s agent is given it');
});

test("an agent's own view of the map reads whether the owner allows it a backup", async () => {
  const whole = await map();
  configureOutbox(async () => whole);
  await callTool(whole.as('e_owner', true), owner, 'workspace_set', { agent_backups: true });
  const made = (await callTool(whole.as('e_agentx'), agent, 'backup_download', {})) as Made;
  assert.ok(await fetched(whole, made), 'a member reads the setting, as an agent token does');
});
test('a link given to a document is in the backup, and works again where the backup is restored', async () => {
  const l = await map();
  const made = await l.change(owner, { reason: 'test', ops: [{ op: 'create', type: 'document', title: 'Shared plan' }] });
  const doc = Object.values((made as { created: Record<string, string> }).created)[0];
  await createShare(l, owner, doc);
  const file = (await fetched(l, (await callTool(l, owner, 'backup_download', {})) as Made))!;
  const there = await openDb();
  assert.equal((await restore(there, { ...parseBackup(file.file), vault: await dumpVault(l.db) })).share, 1);
  assert.deepEqual((await there.query<{ entity_id: string }>(`select entity_id from share`)).rows, [{ entity_id: doc }]);
});

test('a backup is restored from the command line into a new folder, and never over one', async () => {
  const l = await map();
  await l.change(owner, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Carried over' }] });
  const taken = { ...(await dump(l.db, { id: 'default', name: 'Default' })), vault: await dumpVault(l.db) };
  const dir = mkdtempSync(join(tmpdir(), 'pelago-restore-'));
  try {
    const done = await restoreTo(taken, join(dir, 'data'));
    assert.equal(done.counts.entity, (await readable(l.db, taken)).tables.entity.length);
    await assert.rejects(restoreTo(taken, join(dir, 'data')), /already exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const server = process.env.PELAGO_TEST_DATABASE_URL;
test('a backup is restored into a Postgres server where the server looks for its workspace', { skip: !server && 'PELAGO_TEST_DATABASE_URL is not set' }, async () => {
  const l = await map();
  await l.change(owner, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Carried over' }] });
  await l.db.query(`insert into member (email, person_id, admin, added_by) values ('kim@example.com', 'e_kimkimki', false, 'test')`);
  const base = `r${Date.now().toString(36)}`;
  const url = await databaseFor(server!, base); // stands for the server's own database: an empty one
  try {
    const home = { ...(await dump(l.db, { id: 'default', name: 'Default' })), vault: await dumpVault(l.db) };
    const done = await restoreTo(home, url);
    assert.match(done.where, new RegExp(`database \\w+_${base} on `), 'the default workspace goes in the database named');
    assert.doesNotMatch(done.where, /:[^@/]+@/, 'the password is not said');
    await assert.rejects(restoreTo(home, url), /not empty/);
    const other = await restoreTo({ ...home, workspace: { id: 'acme', name: 'Acme' } }, url);
    assert.match(other.where, new RegExp(`_${base}_acme on `), 'another workspace goes in its own database beside it');
    const there = await openDb(await databaseFor(url, 'acme', false));
    assert.equal((await there.query<{ n: number }>(`select count(*)::int as n from entity where title = 'Carried over'`)).rows[0].n, 1);
    await there.close();
    // A workspace restored beside the others is noted in the index of who belongs where: its members sign in.
    const control = await openDb(url);
    const noted = await control.query<{ value: string[] }>(`select value from control_value where key = 'member_in:kim@example.com'`);
    assert.deepEqual(noted.rows[0]?.value, ['default', 'acme']);
    await control.close();
  } finally {
    await dropDatabaseFor(url, 'acme');
    await dropDatabaseFor(server!, base);
  }
});
