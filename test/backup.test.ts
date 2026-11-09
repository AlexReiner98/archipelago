import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { backupAll, dump, merge, newestBackup, readable, readBackup, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { Archipelago } from '../src/pelago.ts';
import { sessionEnd, sessionStart } from '../src/sessions.ts';
import { Workspaces } from '../src/workspaces.ts';
import { dumpVault } from '../src/vault.ts';
import { human, agent, fresh, make } from './map.ts';

test('a backup merges into a map that has moved on: nothing is lost, the later edit wins, and twice is the same as once', async () => {
  const a = await fresh();
  const made = await make(a, [
    { op: 'create', ref: 'p', type: 'aim', title: 'Proj' },
    { op: 'create', ref: 't', type: 'task', title: 'Task' },
    { op: 'create', ref: 'u', type: 'task', title: 'Other task' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
  ]);
  await a.change(agent, { reason: 'waiting', ops: [{ op: 'create', type: 'finding', title: 'Proposed' }] });
  // Each map has its own vault: a copy carries the vault's backup beside it.
  const snapshot = async (l: Archipelago) => ({ ...JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' }))), vault: await dumpVault(l.db) });
  // b starts as a copy of a, then each goes its own way.
  const b = new Archipelago(await openDb(), a.registry);
  await restore(b.db, await snapshot(a));
  const partOf = ((await a.get(made.t)) as any).outgoing[0].relation;

  await make(b, [{ op: 'update', id: made.p, title: 'Proj, renamed in b' }, { op: 'create', type: 'finding', title: 'Only in b' }]);
  await make(a, [
    { op: 'update', id: made.t, title: 'Task, renamed in a' },
    { op: 'unlink', relation: partOf },
    { op: 'archive', id: made.u },
    { op: 'create', ref: 'n', type: 'task', title: 'New in a' },
    { op: 'link', type: 'part_of', from: 'n', to: made.p },
  ]);
  const [pending] = await a.proposals();
  await a.decide(human, { proposal: pending.id, approve: false, note: 'no' });
  const session = await sessionStart(a, agent, { title: 'Still running in a', surface: 'test' });
  const from = await snapshot(a);
  const count = async (l: Archipelago, table: string) => (await l.db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
  const before = [await count(b, 'entity'), await count(b, 'log_op')];

  const options = { workspace: 'default', sessionTypes: b.registry.family('run') };
  const preview = await merge(b.db, from, options);
  assert.deepEqual([preview.applied, await count(b, 'entity'), await count(b, 'log_op')], [false, ...before], 'looking changes nothing');
  const done = await merge(b.db, from, { ...options, apply: true });
  assert.deepEqual({ ...done, applied: false, events: { ...done.events, first_seq: 0, last_seq: 0 } }, { ...preview, events: { ...preview.events, first_seq: 0, last_seq: 0 } }, 'and it does what it said it would');
  assert.deepEqual([done.entities.added, done.entities.updated, done.entities.kept_newer_here], [1, 2, 1], 'the new task; the renamed and the archived one; and the aim b renamed stays');
  assert.deepEqual([done.relations, done.proposals, done.left_out.open_sessions], [{ added: 1, ended: 1 }, { added: 0, decided: 1 }, 1]);
  assert.ok(done.events.added > 0 && done.events.last_seq! - done.events.first_seq! === done.events.added - 1, 'its history arrives as one run of events');

  const title = async (l: Archipelago, id: string) => (await l.entity(id))!.title;
  assert.deepEqual([await title(b, made.t), await title(b, made.p)], ['Task, renamed in a', 'Proj, renamed in b'], "each side's edit survives");
  assert.ok((await b.entity(made.u))!.archived_at, 'archived there, archived here');
  assert.deepEqual(((await b.get(made.t)) as any).outgoing, [], 'unlinked there, unlinked here');
  assert.equal((await b.search({ q: 'Only in b' })).filter((e) => e.title === 'Only in b').length, 1, 'and what b made is still there');
  assert.equal(await b.entity(session.run), undefined, 'a session still open there stays there');
  assert.equal((await b.proposals()).length, 0);
  assert.ok(((await b.get(made.t)) as any).recent_events.some((e: any) => e.action === 'entity.update'), 'with the history of what changed');

  const again = await merge(b.db, from, { ...options, apply: true });
  assert.deepEqual([again.entities.added, again.entities.updated, again.relations, again.events.added, again.proposals], [0, 0, { added: 0, ended: 0 }, 0, { added: 0, decided: 0 }], 'a second time adds nothing');

  // And back the other way: a hears of what b did, and keeps its own.
  const back = await merge(a.db, await snapshot(b), { ...options, apply: true });
  assert.deepEqual([back.entities.added, back.entities.updated, back.entities.kept_newer_here], [1, 1, 0]);
  assert.deepEqual([await title(a, made.p), await title(a, made.t)], ['Proj, renamed in b', 'Task, renamed in a']);
  assert.ok(await a.entity(session.run), 'its own session is untouched');
  // An older file never undoes a newer map.
  const stale = await merge(b.db, from, { ...options, apply: true });
  assert.equal(stale.entities.updated, 0);
});

test('backups are written per workspace, read back, and only the newest are kept', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-backup-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), join(root, 'packs'), { recursive: true });
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(root, 'packs') });
  await workspaces.create('acme', 'Acme');
  await make((await workspaces.get('acme')).pelago, [{ op: 'create', type: 'task', title: 'Theirs' }]);
  const dir = join(root, 'backups');
  assert.equal(newestBackup(dir), undefined);
  for (let i = 0; i < 3; i++) {
    const done = await backupAll(workspaces, dir, 2);
    assert.deepEqual(done.map((d) => [d.workspace, d.error]), [['default', undefined], ['acme', undefined]]);
    await new Promise((r) => setTimeout(r, 5));
  }
  const files = readdirSync(join(dir, 'acme')).filter((f) => f.endsWith('.json.gz'));
  assert.equal(files.length, 2, 'the oldest was removed');
  assert.equal(readdirSync(join(dir, 'acme', 'vault')).length, 3, 'the vault is backed up apart, and kept by age, not by count');
  const read = readBackup(join(dir, 'acme', files.sort().at(-1)!));
  assert.ok(!JSON.stringify(read).includes('Theirs'), 'what items say is sealed in the file');
  const opened = await readable((await workspaces.get('acme')).pelago.db, read);
  assert.deepEqual([read.workspace, opened.tables.entity.map((e) => e.title)], [{ id: 'acme', name: 'Acme' }, ['Theirs']]);
  assert.ok(Date.now() - newestBackup(dir)!.getTime() < 60_000, 'the newest backup\'s time is read from its name');

  // A copy of each new backup goes to a place that takes a file by POST with a key.
  const received: { url?: string; auth?: string; bytes: number }[] = [];
  let refuse = false;
  const store = createServer((req, res) => {
    let bytes = 0;
    req.on('data', (chunk: Buffer) => (bytes += chunk.length));
    req.on('end', () => {
      received.push({ url: req.url, auth: req.headers.authorization, bytes });
      res.writeHead(refuse ? 403 : 200).end(refuse ? 'no' : '{}');
    });
  });
  await new Promise<void>((r) => store.listen(0, '127.0.0.1', r));
  const target = { url: `http://127.0.0.1:${(store.address() as AddressInfo).port}/object/bucket/`, key: 'k' };
  const sent = await backupAll(workspaces, dir, 2, target);
  assert.deepEqual(sent.map((d) => d.copied), [true, true]);
  assert.match(received[1].url!, /^\/object\/bucket\/acme\/.+\.json\.gz$/);
  assert.deepEqual([received[1].auth, received[1].bytes > 100], ['Bearer k', true]);
  refuse = true;
  const failed = await backupAll(workspaces, dir, 2, target);
  assert.deepEqual([failed[0].copied, failed[0].error, /403/.test(failed[0].copy_error!)], [false, undefined, true], 'the backup stands; the failed copy is reported');
  store.close();
  await workspaces.closeAll();
});

test('search puts the best match first and forgives a slip of the keys', async () => {
  const l = await fresh();
  await make(l, [
    { op: 'create', type: 'finding', title: 'Roadmap for the garden app' },
    { op: 'create', type: 'finding', title: 'Hosting', body: 'Where the deployment runs.' },
    { op: 'create', type: 'finding', title: 'Unrelated', body: 'Mentions hosting once, in passing, among many other words about something else entirely.' },
    { op: 'create', type: 'finding', title: 'Nothing to do with it' },
  ]);
  const titles = async (q: string) => (await l.search({ q })).map((e) => e.title);
  assert.deepEqual(await titles('hosting'), ['Hosting', 'Unrelated'], 'a title match outranks a newer mention in the notes');
  assert.deepEqual(await titles('deployments'), ['Hosting'], 'another form of a word in the notes');
  assert.deepEqual(await titles('roadmp'), ['Roadmap for the garden app'], 'a typo in a title word');
  assert.deepEqual(await titles('zebra'), []);
});

test('a workspace nobody is using is closed, and opens again with its data', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-idle-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), join(root, 'packs'), { recursive: true });
  const workspaces = new Workspaces({ dataDir: join(root, 'data'), rootDir: join(root, 'workspaces'), packsDir: join(root, 'packs') });
  await workspaces.get('default');
  const acme = await workspaces.create('acme', 'Acme');
  await make(acme.pelago, [{ op: 'create', type: 'task', title: 'Theirs' }]);

  const release = workspaces.hold('acme');
  assert.deepEqual(await workspaces.closeIdle(0), [], 'not while a request is in hand, and never the default workspace');
  release();
  assert.deepEqual(await workspaces.closeIdle(60_000), [], 'not until it has been unused for long enough');
  assert.deepEqual(await workspaces.closeIdle(0), ['acme']);
  assert.deepEqual([workspaces.isOpen('acme'), workspaces.isOpen('default')], [false, true]);

  const again = await workspaces.get('acme');
  assert.deepEqual((await again.pelago.search({ type: 'task' })).map((e) => e.title), ['Theirs'], 'the data is there when it opens again');
  const session = await sessionStart(again.pelago, agent, { title: 'Working' });
  assert.deepEqual(await workspaces.closeIdle(0), [], 'a workspace with an open session stays open, so the session can be seen to go quiet');
  await sessionEnd(again.pelago, agent, { run: session.run, outcome: 'finished', summary: 'done' });

  const dir = join(root, 'backups');
  assert.deepEqual(await workspaces.closeIdle(0), ['acme']);
  await backupAll(workspaces, dir, 2);
  assert.equal(workspaces.isOpen('acme'), false, 'a backup closes what it had to open');
  await workspaces.closeAll();
});
