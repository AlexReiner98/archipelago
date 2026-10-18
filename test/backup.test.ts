import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { backupAll, dump, merge, newestBackup, readBackup, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { Archipelago } from '../src/pelago.ts';
import { sessionEnd, sessionStart } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { VIEWS } from '../src/views.ts';
import { Workspaces } from '../src/workspaces.ts';
import { human, agent, fresh, make } from './map.ts';

test('a backup merges into a map that has moved on: nothing is lost, the later edit wins, and twice is the same as once', async () => {
  const a = await fresh();
  const made = await make(a, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Proj' },
    { op: 'create', ref: 't', type: 'work.task', title: 'Task' },
    { op: 'create', ref: 'u', type: 'work.task', title: 'Other task' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
  ]);
  await a.change(agent, { reason: 'waiting', ops: [{ op: 'create', type: 'work.note', title: 'Proposed' }] });
  const snapshot = async (l: Archipelago) => JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' })));
  // b starts as a copy of a, then each goes its own way.
  const b = new Archipelago(await openDb(), a.registry);
  await restore(b.db, await snapshot(a));
  const partOf = ((await a.get(made.t)) as any).outgoing[0].relation;

  await make(b, [{ op: 'update', id: made.p, title: 'Proj, renamed in b' }, { op: 'create', type: 'work.note', title: 'Only in b' }]);
  await make(a, [
    { op: 'update', id: made.t, title: 'Task, renamed in a' },
    { op: 'unlink', relation: partOf },
    { op: 'archive', id: made.u },
    { op: 'create', ref: 'n', type: 'work.task', title: 'New in a' },
    { op: 'link', type: 'part_of', from: 'n', to: made.p },
  ]);
  const [pending] = await a.proposals();
  await a.decide(human, { proposal: pending.id, approve: false, note: 'no' });
  const session = await sessionStart(a, agent, { title: 'Still running in a', surface: 'test' });
  const from = await snapshot(a);
  const count = async (l: Archipelago, table: string) => (await l.db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
  const before = [await count(b, 'entity'), await count(b, 'event')];

  const options = { workspace: 'default', sessionTypes: b.registry.family('sys.run') };
  const preview = await merge(b.db, from, options);
  assert.deepEqual([preview.applied, await count(b, 'entity'), await count(b, 'event')], [false, ...before], 'looking changes nothing');
  const done = await merge(b.db, from, { ...options, apply: true });
  assert.deepEqual({ ...done, applied: false, events: { ...done.events, first_seq: 0, last_seq: 0 } }, { ...preview, events: { ...preview.events, first_seq: 0, last_seq: 0 } }, 'and it does what it said it would');
  assert.deepEqual([done.entities.added, done.entities.updated, done.entities.kept_newer_here], [1, 2, 1], 'the new task; the renamed and the archived one; and the project b renamed stays');
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
  await make((await workspaces.get('acme')).pelago, [{ op: 'create', type: 'work.task', title: 'Theirs' }]);
  const dir = join(root, 'backups');
  assert.equal(newestBackup(dir), undefined);
  for (let i = 0; i < 3; i++) {
    const done = await backupAll(workspaces, dir, 2);
    assert.deepEqual(done.map((d) => [d.workspace, d.error]), [['default', undefined], ['acme', undefined]]);
    await new Promise((r) => setTimeout(r, 5));
  }
  const files = readdirSync(join(dir, 'acme'));
  assert.equal(files.length, 2, 'the oldest was removed');
  const read = readBackup(join(dir, 'acme', files.sort().at(-1)!));
  assert.deepEqual([read.workspace, read.tables.entity.map((e) => e.title)], [{ id: 'acme', name: 'Acme' }, ['Theirs']]);
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
    { op: 'create', type: 'work.note', title: 'Roadmap for the garden app' },
    { op: 'create', type: 'work.note', title: 'Hosting', body: 'Where the deployment runs.' },
    { op: 'create', type: 'work.note', title: 'Unrelated', body: 'Mentions hosting once, in passing, among many other words about something else entirely.' },
    { op: 'create', type: 'work.note', title: 'Nothing to do with it' },
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
  await make(acme.pelago, [{ op: 'create', type: 'work.task', title: 'Theirs' }]);

  const release = workspaces.hold('acme');
  assert.deepEqual(await workspaces.closeIdle(0), [], 'not while a request is in hand, and never the default workspace');
  release();
  assert.deepEqual(await workspaces.closeIdle(60_000), [], 'not until it has been unused for long enough');
  assert.deepEqual(await workspaces.closeIdle(0), ['acme']);
  assert.deepEqual([workspaces.isOpen('acme'), workspaces.isOpen('default')], [false, true]);

  const again = await workspaces.get('acme');
  assert.deepEqual((await again.pelago.search({ type: 'work.task' })).map((e) => e.title), ['Theirs'], 'the data is there when it opens again');
  const session = await sessionStart(again.pelago, agent, { title: 'Working' });
  assert.deepEqual(await workspaces.closeIdle(0), [], 'a workspace with an open session stays open, so the session can be seen to go quiet');
  await sessionEnd(again.pelago, agent, { run: session.run, outcome: 'finished', summary: 'done' });

  const dir = join(root, 'backups');
  assert.deepEqual(await workspaces.closeIdle(0), ['acme']);
  await backupAll(workspaces, dir, 2);
  assert.equal(workspaces.isOpen('acme'), false, 'a backup closes what it had to open');
  await workspaces.closeAll();
});

test('an event is a gate: what holds it by stream, what can follow, and what is not yet sorted', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'create', ref: 'app', type: 'work.project', title: 'App' },
    { op: 'create', ref: 'business', type: 'work.project', title: 'Business' },
    { op: 'create', ref: 'addin', type: 'software.feature', title: 'Add-in' },
    { op: 'create', ref: 'installer', type: 'software.feature', title: 'Installer' },
    { op: 'create', ref: 'docs', type: 'software.feature', title: 'Docs' },
    { op: 'create', ref: 'sign', type: 'work.task', title: 'Sign the package' },
    { op: 'create', ref: 'cert', type: 'work.decision', title: 'Which certificate?', owner: 'me' },
    { op: 'create', ref: 'clean', type: 'work.task', title: 'Uninstall leaves it clean', status: 'done' },
    { op: 'create', ref: 'hover', type: 'work.task', title: 'Hover cards' },
    { op: 'create', ref: 'extras', type: 'work.task', title: 'Capture extras' },
    { op: 'create', ref: 'guide', type: 'work.task', title: 'Write the guide' },
    { op: 'create', ref: 'pricing', type: 'work.decision', title: 'What does it cost?', owner: 'me' },
    { op: 'create', ref: 'release', type: 'software.release', title: 'Version 1.0' },
    { op: 'link', type: 'part_of', from: 'addin', to: 'app' },
    { op: 'link', type: 'part_of', from: 'installer', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'docs', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'sign', to: 'installer' },
    { op: 'link', type: 'part_of', from: 'cert', to: 'installer' },
    { op: 'link', type: 'part_of', from: 'clean', to: 'installer' },
    { op: 'link', type: 'part_of', from: 'hover', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'extras', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'guide', to: 'docs' },
    { op: 'link', type: 'part_of', from: 'pricing', to: 'business' },
    { op: 'link', type: 'depends_on', from: 'sign', to: 'cert' },
    { op: 'link', type: 'software.ships', from: 'release', to: 'addin' },
    // A feature that holds the event brings its work; a single item sits under the stream it is part of.
    { op: 'link', type: 'depends_on', from: 'release', to: 'installer' },
    { op: 'link', type: 'depends_on', from: 'release', to: 'pricing' },
    { op: 'link', type: 'defers', from: 'release', to: 'hover' },
  ]);
  await l.init(human, { name: 'Owner' });
  type Gate = {
    counts: Record<string, number>;
    clear: boolean;
    to_sort: { id: string; stream: { title: string } | null }[];
    streams: { id: string | null; title: string | null; yours: number; progress: { done: number; total: number }; items: { id: string; yours: boolean; done: boolean; relation?: string }[] }[];
    can_follow: { id: string; relation: string }[];
  };
  const gate = (await VIEWS.gate.run(l, { event: made.release })) as Gate;
  assert.deepEqual(gate.counts, { holding: 4, open: 3, yours: 3, to_sort: 2, can_follow: 1 });
  assert.equal(gate.clear, false);
  // Not sorted: open work under what ships that is on neither side. What is held, deferred or outside what ships is not asked about.
  assert.deepEqual(gate.to_sort.map((x) => x.id).sort(), [made.extras, made.guide].sort());
  assert.equal(gate.to_sort.find((x) => x.id === made.guide)!.stream!.title, 'Docs');
  const installer = gate.streams.find((s) => s.id === made.installer)!;
  assert.deepEqual(installer.progress, { done: 1, total: 3 });
  // The decision is the owner's, and so is the task that cannot move until it is made.
  assert.equal(installer.yours, 2);
  assert.equal(installer.items.at(-1)!.id, made.clean, 'what is done comes last');
  const business = gate.streams.find((s) => s.id === made.business)!;
  assert.equal(business.items[0].id, made.pricing);
  assert.ok(business.items[0].relation, 'an item that holds the event itself says by which link');
  assert.deepEqual(gate.can_follow.map((x) => x.id), [made.hover]);

  // Sorting is two links; moving one across is an unlink and a link.
  await make(l, [
    { op: 'link', type: 'depends_on', from: made.release, to: made.guide },
    { op: 'link', type: 'defers', from: made.release, to: made.extras },
  ]);
  const sorted = (await VIEWS.gate.run(l, { event: made.release })) as Gate;
  assert.equal(sorted.counts.to_sort, 0);
  assert.equal(sorted.streams.find((s) => s.id === made.docs)!.items[0].id, made.guide);

  await assert.rejects(VIEWS.gate.run(l, { event: made.app }), /needs an event/);
  await assert.rejects(l.change(human, { ops: [{ op: 'link', type: 'defers', from: made.app, to: made.hover }], reason: 'test' }), /must start from event/);
  const listed = (await VIEWS.gate.run(l, {})) as { events: { id: string }[] };
  assert.deepEqual(listed.events.map((e) => e.id), [made.release]);
});

test('a proof question is answered on a build when every test of it passed there', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'app', type: 'work.project', title: 'App' },
    { op: 'create', ref: 'solver', type: 'software.feature', title: 'Solver' },
    { op: 'create', ref: 'sun', type: 'software.proof', title: 'How do we know the sun is correct?' },
    { op: 'create', ref: 'areas', type: 'software.proof', title: 'How do we know the areas are correct?' },
    { op: 'create', ref: 'noaa', type: 'software.test', title: 'Sun position against NOAA', status: 'current', props: { entrypoint: 'Sun.MatchesNoaa', tolerance: 'within 0.01 degrees' } },
    { op: 'create', ref: 'pole', type: 'software.test', title: 'Shadow of a pole', status: 'current', props: { entrypoint: 'Sun.PoleShadow' } },
    { op: 'create', ref: 'square', type: 'software.test', title: 'Area of a square' },
    { op: 'link', type: 'part_of', from: 'solver', to: 'app' },
    { op: 'link', type: 'part_of', from: 'sun', to: 'solver' },
    { op: 'link', type: 'about', from: 'areas', to: 'app' },
    { op: 'link', type: 'software.answers', from: 'noaa', to: 'sun' },
    { op: 'link', type: 'software.answers', from: 'pole', to: 'sun' },
    { op: 'link', type: 'software.answers', from: 'square', to: 'areas' },
  ]);
  type Proof = {
    build: string | null;
    builds: string[];
    counts: Record<string, number>;
    proofs: { id: string; answered: boolean; passed: number; failed: number; not_run: number; tests: { id: string; result: { id: string; passed: boolean; value: string | null; picture: string | null } | null; before: { build: string } | null }[] }[];
  };
  const view = async (build?: string) => (await callTool(l, human, 'view', { name: 'proof', params: { of: made.app, build } })) as Proof;
  const none = await view();
  assert.equal(none.build, null);
  assert.deepEqual(none.counts, { questions: 2, answered: 0, tests: 3, passed: 0, failed: 0, not_run: 3 });

  // A harness knows its tests by name. One it names that the map does not know is said back, and nothing is made for it.
  const first = (await callTool(l, human, 'test_report', {
    build: '1.0.0',
    results: [
      { test: 'Sun.MatchesNoaa', passed: true, value: '0.004 degrees', picture: '.proof/1.0.0/noaa.png' },
      { test: made.pole, passed: false, value: '3 mm out' },
      { test: 'Sun.Nobody', passed: true },
    ],
  })) as { answer: { recorded: number; passed: number; failed: number; unknown: string[] } };
  assert.deepEqual({ recorded: first.answer.recorded, passed: first.answer.passed, failed: first.answer.failed, unknown: first.answer.unknown }, { recorded: 2, passed: 1, failed: 1, unknown: ['Sun.Nobody'] });
  const one = await view();
  assert.equal(one.build, '1.0.0');
  const sun = one.proofs.find((p) => p.id === made.sun)!;
  assert.deepEqual({ answered: sun.answered, passed: sun.passed, failed: sun.failed }, { answered: false, passed: 1, failed: 1 });
  assert.equal(sun.tests[0].id, made.pole, 'what failed comes first');
  assert.equal(sun.tests[1].result!.picture, '.proof/1.0.0/noaa.png');

  // Reported again on the same build, a result is replaced, not added to; what the new run does not say is cleared.
  await callTool(l, human, 'test_report', { build: '1.0.0', results: [{ test: made.pole, passed: true }] });
  const two = await view();
  const again = two.proofs.find((p) => p.id === made.sun)!;
  assert.equal(again.answered, true);
  assert.equal(again.tests.find((t) => t.id === made.pole)!.result!.id, sun.tests[0].result!.id);
  assert.equal(again.tests.find((t) => t.id === made.pole)!.result!.value, null);
  // A test that is wanted and not written leaves its question unanswered.
  assert.equal(two.proofs.find((p) => p.id === made.areas)!.answered, false);
  assert.deepEqual(two.counts, { questions: 2, answered: 1, tests: 3, passed: 2, failed: 0, not_run: 1 });

  // A new build starts from nothing: what was proven on the last one is not proven on this one.
  await callTool(l, human, 'test_report', { build: '1.0.1', results: [{ test: made.noaa, passed: true }] });
  const next = await view();
  assert.equal(next.build, '1.0.1');
  assert.deepEqual(next.builds, ['1.0.1', '1.0.0']);
  const later = next.proofs.find((p) => p.id === made.sun)!;
  assert.equal(later.answered, false);
  assert.equal(later.tests.find((t) => t.id === made.pole)!.before!.build, '1.0.0');
  assert.equal((await view('1.0.0')).proofs.find((p) => p.id === made.sun)!.answered, true);

  const listed = (await callTool(l, human, 'view', { name: 'proof', params: {} })) as { products: { id: string; questions: number }[] };
  assert.deepEqual(listed.products.map((p) => [p.id, p.questions]), [[made.app, 2]]);
  await assert.rejects(callTool(l, human, 'test_report', { build: '1.0.1', results: [{ test: made.noaa, passed: true }, { test: 'Sun.MatchesNoaa', passed: true }] }), /reported twice/);
});

