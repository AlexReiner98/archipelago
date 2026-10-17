import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Automations } from '../src/automations.ts';
import { backupAll, dump, merge, newestBackup, readBackup, restore } from '../src/backup.ts';
import { heldResources } from '../src/blocking.ts';
import { openDb } from '../src/db.ts';
import { configureLauncher, launch } from '../src/launcher.ts';
import { pictureOf } from '../src/lens.ts';
import { Archipelago, type Actor, type Op } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { publicPage, publicPicture } from '../src/public.ts';
import { configureSecrets, isSealed, seal, unseal } from '../src/secrets.ts';
import { hookSessionEnd, hookSessionStart, recordUsage, sessionEnd, sessionStart, sessionUpdate, tell } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { VIEWS } from '../src/views.ts';
import { Workspaces } from '../src/workspaces.ts';

const human: Actor = { kind: 'human', name: 'test' };
const agent: Actor = { kind: 'agent', name: 'test' };

/** A fresh in-memory map with its own copy of the packs, so tests can define types. */
async function fresh() {
  const packs = mkdtempSync(join(tmpdir(), 'pelago-packs-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  return new Archipelago(await openDb(), new Registry(packs));
}

const attend = async (l: Archipelago, params: Record<string, unknown>) => (await callTool(l, human, 'view', { name: 'attention', params })) as any;

async function make(l: Archipelago, ops: Op[]) {
  const result = await l.change(human, { ops, reason: 'test' });
  assert.equal(result.status, 'applied');
  return (result as { created: Record<string, string> }).created;
}

test('a database made while this was called Lattice is opened under the new names, with nothing lost', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-before-'));
  const made = await openDb(dir);
  // As it stood then: the two roles with what they were granted, a function of that name, and events said to be Lattice's own.
  await made.exec(`
    create role lattice_member nologin; grant select, insert, update on entity, event to lattice_member;
    create role lattice_public nologin; grant select (id, title) on entity to lattice_public;
    create function lattice_is_public(target text) returns boolean language sql stable as $fn$ select false $fn$;
    grant execute on function lattice_is_public(text) to lattice_public;
    insert into event (origin, actor, action) values ('lattice', 'agent:lattice', 'run.stale'), ('github', 'github:push', 'push');
  `);
  await made.close();
  const db = await openDb(dir);
  assert.deepEqual((await db.query<{ rolname: string }>(`select rolname from pg_roles where rolname like 'lattice%' or rolname like 'pelago%' order by 1`)).rows.map((r) => r.rolname), ['pelago_member', 'pelago_public']);
  assert.deepEqual((await db.query<{ proname: string }>(`select proname from pg_proc where proname like 'lattice%'`)).rows, []);
  assert.deepEqual((await db.query<{ origin: string }>(`select origin from event order by seq`)).rows.map((r) => r.origin), ['pelago', 'github']);
  // And a member still sees through the role that took the old one's place.
  const packs = mkdtempSync(join(tmpdir(), 'pelago-packs-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  const l = new Archipelago(db, new Registry(packs));
  await make(l, [{ op: 'create', type: 'task', title: 'Seen after the move' }]);
  assert.equal((await l.as('nobody').db.query(`select 1 from entity where title = 'Seen after the move'`)).rows.length, 1);
  await db.close();
});

test('flavours inherit fields and statuses, and are found through the parent', async () => {
  const l = await fresh();
  const bug = l.registry.type('software.bug')!;
  assert.deepEqual(bug.lineage, ['software.bug', 'issue', 'work']);
  assert.ok(bug.fields.severity, 'inherits issue.severity');
  assert.ok(bug.fields.repro, 'adds its own field');
  assert.deepEqual(bug.statuses, l.registry.type('issue')!.statuses);

  await make(l, [
    { op: 'create', type: 'software.bug', title: 'Crash on load', props: { severity: 'high' } },
    { op: 'create', type: 'issue', title: 'Slow builds' },
  ]);
  assert.equal((await l.search({ type: 'issue' })).length, 2);
  assert.equal((await l.search({ type: 'software.bug' })).length, 1);
});

test('a flavour can override an inherited default', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'lane', type: 'resource', title: 'Lane' },
    { op: 'create', ref: 'conn', type: 'sys.connection', title: 'Conn' },
  ]);
  assert.equal((await l.entity(made.lane))!.props.exclusive, true);
  assert.equal((await l.entity(made.conn))!.props.exclusive, false);
});

test('invalid changes are rejected whole, with every problem listed', async () => {
  const l = await fresh();
  await assert.rejects(
    l.change(human, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 't', type: 'task', title: 'Good task' },
        { op: 'create', type: 'task', title: 'Bad status', status: 'finished' },
        { op: 'create', type: 'task', title: 'Bad field', props: { colour: 'red', due: 'tomorrow' } },
        { op: 'link', type: 'works_at', from: 't', to: 'nope' },
        { op: 'create', type: 'unicorn', title: 'x' },
      ],
    }),
    (err: Error) => {
      for (const part of ['status "finished"', 'no field "colour"', 'task.due must be a date', 'no entity or ref "nope"', 'unknown type "unicorn"']) {
        assert.ok(err.message.includes(part), `expected "${part}" in:\n${err.message}`);
      }
      return true;
    },
  );
  assert.equal((await l.search({})).length, 0, 'nothing was written');
  await assert.rejects(make(l, [
    { op: 'create', ref: 'a', type: 'task', title: 'A' },
    { op: 'create', ref: 'c', type: 'company', title: 'C' },
    { op: 'link', type: 'works_at', from: 'a', to: 'c' },
  ]), /must start from person, not task/);
  await assert.rejects(l.change(human, { ops: [{ op: 'create', type: 'task', title: 'A' }], reason: ' ' }), /needs a reason/);
});

test('an agent change becomes a proposal; a human approves it, minus exclusions', async () => {
  const l = await fresh();
  const proposed = await l.change(agent, {
    reason: 'Read the handoff doc',
    source: { uri: 'docs/handoff.md', kind: 'file' },
    ops: [
      { op: 'create', ref: 'proj', type: 'project', title: 'Shadow' },
      { op: 'create', ref: 'a', type: 'task', title: 'Fix parity' },
      { op: 'create', ref: 'b', type: 'task', title: 'Wrong guess' },
      { op: 'link', type: 'part_of', from: 'a', to: 'proj' },
      { op: 'link', type: 'part_of', from: 'b', to: 'proj' },
      { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
    ],
  });
  assert.equal(proposed.status, 'proposed');
  assert.equal((await l.search({})).length, 0, 'nothing applied yet');

  const id = (proposed as { proposal: string }).proposal;
  await assert.rejects(l.decide(agent, { proposal: id, approve: true }), /Only a human/);
  await assert.rejects(callTool(l, agent, 'decide', { proposal: id, approve: true }), /humans only/);

  const decided = await l.decide(human, { proposal: id, approve: true, except: ['b'] });
  assert.equal(decided.status, 'approved');
  const tasks = await l.search({ type: 'task' });
  assert.deepEqual(tasks.map((t) => t.title), ['Fix parity']);
  const task = await l.get(tasks[0].id);
  assert.deepEqual(task.outgoing.map((r: any) => r.type), ['part_of'], 'links to the excluded entity were dropped');
  assert.equal(task.source?.uri, 'docs/handoff.md');

  // The log says who proposed and who approved.
  const created = (await l.events({ target: tasks[0].id })) as any[];
  assert.equal(created[0].actor, 'agent:test');
  assert.equal(created[0].detail.approved_by, 'human:test');
  assert.equal(created[0].reason, 'Read the handoff doc');
  await assert.rejects(l.decide(human, { proposal: id, approve: true }), /already approved/);
});

test('the pulse moves when a change is proposed, decided or applied, and not otherwise', async () => {
  const l = await fresh();
  const stamp = async () => (await l.pulse()).stamp;
  const seen = [await stamp()];
  assert.equal(await stamp(), seen[0], 'reading does not move it');

  const proposed = await l.change(agent, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'A' }] });
  seen.push(await stamp());
  await l.decide(human, { proposal: (proposed as { proposal: string }).proposal, approve: false });
  seen.push(await stamp());
  await make(l, [{ op: 'create', type: 'task', title: 'B' }]);
  seen.push(await stamp());
  assert.equal(new Set(seen).size, seen.length, `each write gives a new stamp: ${seen.join(', ')}`);
});

test('policy can let agents apply some ops directly, or forbid them', async () => {
  const l = await fresh();
  const loose = new Archipelago(l.db, l.registry, { create: 'auto', merge: 'forbidden' });
  const made = await loose.change(agent, { ops: [{ op: 'create', ref: 'x', type: 'note', title: 'X' }], reason: 'test' });
  assert.equal(made.status, 'applied');
  const x = (made as { created: Record<string, string> }).created.x;
  const y = (await make(l, [{ op: 'create', ref: 'y', type: 'note', title: 'Y' }])).y;
  await assert.rejects(loose.change(agent, { ops: [{ op: 'merge', keep: x, drop: y }], reason: 'test' }), /forbids/);
  const mixed = await loose.change(agent, {
    ops: [{ op: 'create', type: 'note', title: 'Z' }, { op: 'archive', id: y }],
    reason: 'test',
  });
  assert.equal(mixed.status, 'proposed', 'one op needing approval holds the whole change');
});

test('possible duplicates are flagged, across flavours', async () => {
  const l = await fresh();
  await make(l, [{ op: 'create', type: 'issue', title: 'Mask misregistration' }]);
  const result = await l.change(agent, { ops: [{ op: 'create', type: 'software.bug', title: 'mask misregistration' }], reason: 'test' });
  assert.match(result.warnings[0], /possible duplicate of existing issue "Mask misregistration"/);
});

test('blockers are derived, and roots are what has to move first', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Me' },
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam' },
    { op: 'create', ref: 'ship', type: 'task', title: 'Ship release', owner: 'me' },
    { op: 'create', ref: 'sign', type: 'task', title: 'Sign installer', owner: 'me' },
    { op: 'create', ref: 'cert', type: 'decision', title: 'Which certificate?', owner: 'sam' },
    { op: 'create', ref: 'free', type: 'task', title: 'Write notes', owner: 'me' },
    { op: 'link', type: 'depends_on', from: 'ship', to: 'sign' },
    { op: 'link', type: 'depends_on', from: 'sign', to: 'cert' },
  ]);

  const ship = (await attend(l, { reasons: ['blocked'] })).items.find((i: any) => i.id === made.ship);
  assert.deepEqual(ship.reasons[0].by, ['Which certificate?'], 'what has to move first, at the root of the chain');

  assert.deepEqual((await attend(l, { person: made.me, reasons: ['ready'] })).items.map((t: any) => t.title), ['Write notes']);
  assert.equal((await attend(l, { person: made.me, reasons: ['blocked'] })).items.length, 2);
  assert.equal((await attend(l, { person: made.sam, reasons: ['holding_up'] })).items[0].reasons[0].count, 2);

  // Closing the decision unblocks the next task in the chain, with nothing else to update.
  await make(l, [{ op: 'update', id: made.cert, status: 'decided', props: { outcome: 'EV cert' } }]);
  const after = await attend(l, { person: made.me, reasons: ['ready'] });
  assert.deepEqual(after.items.map((t: any) => t.title).sort(), ['Sign installer', 'Write notes']);
  await assert.rejects(attend(l, { person: 'me' }), /pelago init/);
});

test('a dependency cycle does not hang the views', async () => {
  const l = await fresh();
  await make(l, [
    { op: 'create', ref: 'a', type: 'task', title: 'A' },
    { op: 'create', ref: 'b', type: 'task', title: 'B' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
  ]);
  assert.equal((await attend(l, { reasons: ['blocked'] })).items.length, 2);
});

test('an exclusive resource has one holder, and blocks other work that needs it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'lane', type: 'resource', title: 'Live Rhino lane' },
    { op: 'create', ref: 'run1', type: 'sys.run', title: 'Session one' },
    { op: 'create', ref: 'run2', type: 'sys.run', title: 'Session two' },
    { op: 'create', ref: 'live1', type: 'task', title: 'Capture parity probe' },
    { op: 'create', ref: 'live2', type: 'task', title: 'Debug conduit' },
    { op: 'create', ref: 'offline', type: 'task', title: 'Write unit tests' },
    { op: 'link', type: 'needs', from: 'live1', to: 'lane' },
    { op: 'link', type: 'needs', from: 'live2', to: 'lane' },
  ]);
  assert.equal((await attend(l, { reasons: ['ready'] })).items.length, 3);

  // Agents claim directly: no proposal.
  const claimed = await l.claim(agent, { resource: made.lane, holder: made.run1, for: made.live1, reason: 'Running the probe' });
  assert.equal(claimed.status, 'claimed');
  await assert.rejects(l.claim(agent, { resource: made.lane, holder: made.run2, reason: 'Me too' }), /held by "Session one"/);

  const during = await attend(l, { reasons: ['ready', 'blocked'] });
  assert.deepEqual(during.items.filter((t: any) => t.reasons[0].why === 'ready').map((t: any) => t.title).sort(), ['Capture parity probe', 'Write unit tests']);
  assert.deepEqual(during.items.filter((t: any) => t.reasons[0].why === 'blocked').map((t: any) => [t.title, t.reasons[0].by]), [['Debug conduit', ['Live Rhino lane']]]);
  assert.equal((await heldResources(l))[0].held_by_title, 'Session one');

  assert.deepEqual(await l.release(agent, { resource: made.lane, holder: made.run1, reason: 'Done' }), { released: 1 });
  assert.equal((await l.claim(agent, { resource: made.lane, holder: made.run2, reason: 'My turn' })).status, 'claimed');
});

test('overdue work is due, and what is far off is not', async () => {
  const l = await fresh();
  await make(l, [
    { op: 'create', type: 'task', title: 'File return', props: { due: '2020-01-01' } },
    { op: 'create', type: 'task', title: 'Far off', props: { due: '2999-01-01' } },
  ]);
  // Work resting on a refuted hypothesis is the inquiry pack's to show, not the kernel's.
  const due = await attend(l, { reasons: ['due'] });
  assert.deepEqual(due.items.map((t: any) => [t.title, t.reasons[0].overdue]), [['File return', true]]);
});

test('merge moves relations to the kept entity and archives the other', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 's1', type: 'person', title: 'Sam Patel', props: { email: 'sam@example.com' } },
    { op: 'create', ref: 's2', type: 'person', title: 'S. Patel', props: { role: 'Planner' } },
    { op: 'create', ref: 'co', type: 'company', title: 'Acme' },
    { op: 'create', ref: 't', type: 'task', title: 'Reply to Sam', owner: 's2' },
    { op: 'link', type: 'works_at', from: 's2', to: 'co' },
    // Both are said to work at the same place: the kept one is linked to it once, not twice.
    { op: 'link', type: 'works_at', from: 's1', to: 'co' },
  ]);
  await make(l, [{ op: 'merge', keep: made.s1, drop: made.s2 }]);
  const sam = await l.get(made.s1);
  assert.deepEqual(sam.entity.props, { email: 'sam@example.com', role: 'Planner' });
  assert.deepEqual(sam.outgoing.map((r: any) => r.title), ['Acme']);
  assert.equal((await l.entity(made.t))!.owner, made.s1);
  assert.deepEqual((await l.search({ type: 'person' })).map((p) => p.title), ['Sam Patel']);
});

test('an approved type proposal becomes a flavour in the local pack', async () => {
  const l = await fresh();
  const proposed = await l.change(agent, {
    reason: 'Site visits keep coming up',
    ops: [{ op: 'define_type', type: { id: 'local.site_visit', title: 'Site visit', description: 'A visit to a site.', extends: 'event', fields: { address: { type: 'string' } } } }],
  });
  assert.equal(proposed.status, 'proposed');
  assert.equal(l.registry.type('local.site_visit'), undefined);
  await l.decide(human, { proposal: (proposed as { proposal: string }).proposal, approve: true });
  assert.deepEqual(l.registry.type('local.site_visit')!.lineage, ['local.site_visit', 'event', 'occurrence']);
  await make(l, [{ op: 'create', type: 'local.site_visit', title: 'Snowdon', props: { address: '1 High St', at: '2026-11-01T10:00:00Z' } }]);
  assert.equal((await l.search({ type: 'event' })).length, 1);
  await assert.rejects(make(l, [{ op: 'define_type', type: { id: 'thing', title: 'T', description: '' } }]), /must look like "local.my_type"/);
});

test('a connection\'s tool-call log is imported once into the activity log', async () => {
  const l = await fresh();
  const log = join(mkdtempSync(join(tmpdir(), 'pelago-audit-')), 'audit.jsonl');
  const line = (ts: string, tool: string) => JSON.stringify({ ts, tool, params: { n: 1 }, durationMs: 12, ok: true, error: null });
  writeFileSync(log, [line('2026-10-01T10:00:00.000Z', 'nodegraph_add_node'), 'not json', line('2026-10-01T10:00:05.000Z', 'run_command')].join('\n'));
  const made = await make(l, [{ op: 'create', ref: 'c', type: 'sys.connection', title: 'Aperture', props: { audit_log: log } }]);

  assert.deepEqual(await l.importAudit(agent, { connection: made.c }), { imported: 2, skipped: 1, path: log });
  writeFileSync(log, [line('2026-10-01T10:00:00.000Z', 'nodegraph_add_node'), line('2026-10-01T10:00:09.000Z', 'form_snapshot')].join('\n'));
  assert.equal((await l.importAudit(agent, { connection: made.c })).imported, 1, 'only entries after the cursor');

  const external = (await l.events({ origin: 'external' })) as any[];
  assert.deepEqual(external.map((e) => e.action), ['form_snapshot', 'run_command', 'nodegraph_add_node']);
  assert.equal(external[0].actor, 'external:Aperture');
  assert.equal(new Date(external[0].ts).toISOString(), '2026-10-01T10:00:09.000Z');
});

test('tool input is validated before anything runs', async () => {
  const l = await fresh();
  await assert.rejects(callTool(l, agent, 'change', { ops: [{ op: 'explode' }], reason: 'x' }), /Invalid input for change/);
  await assert.rejects(callTool(l, agent, 'search', { query: 'x' }), /Invalid input for search/);
  await assert.rejects(callTool(l, agent, 'nope', {}), /No tool "nope"/);
  assert.ok(Object.keys((await callTool(l, agent, 'view', {})) as object).includes('attention'));
});

test('each fact can carry its own source within one change', async () => {
  const l = await fresh();
  const result = await l.change(human, {
    reason: 'test',
    source: { uri: 'docs/roadmap.md' },
    ops: [
      { op: 'create', ref: 'a', type: 'note', title: 'From the roadmap' },
      { op: 'create', ref: 'b', type: 'note', title: 'From the readme', source: { uri: 'README.md', kind: 'file' } },
      { op: 'create', ref: 'c', type: 'note', title: 'Also from the readme', source: { uri: 'README.md' } },
    ],
  });
  const made = (result as { created: Record<string, string> }).created;
  assert.equal((await l.get(made.a)).source?.uri, 'docs/roadmap.md');
  assert.equal((await l.get(made.b)).source?.uri, 'README.md');
  assert.equal((await l.search({ type: 'sys.source' })).length, 2, 'the same uri is recorded once');
});

test('a reviewer can correct a proposal while approving it', async () => {
  const l = await fresh();
  const proposed = await l.change(agent, {
    reason: 'test',
    ops: [{ op: 'create', ref: 'f', type: 'software.feature', title: 'Presets', status: 'planned' }],
  });
  const id = (proposed as { proposal: string }).proposal;
  await assert.rejects(
    l.decide(human, { proposal: id, approve: true, ops: [{ op: 'create', type: 'software.feature', title: 'Presets', status: 'nonsense' }] }),
    /status "nonsense"/,
  );
  assert.equal((await l.proposals()).length, 1, 'a rejected correction leaves the proposal pending');

  await l.decide(human, { proposal: id, approve: true, ops: [{ op: 'create', ref: 'f', type: 'software.feature', title: 'Presets', status: 'shipped' }] });
  const [feature] = await l.search({ type: 'software.feature' });
  assert.equal(feature.status, 'shipped');
  const [event] = (await l.events({ target: feature.id })) as any[];
  assert.equal(event.actor, 'agent:test');
  assert.equal(event.detail.revised_by, 'human:test');
});

/** A project in a repo, with one task that needs the live lane and one that does not. */
async function laneSetup(l: Archipelago) {
  return make(l, [
    { op: 'create', ref: 'repo', type: 'software.repo', title: 'Aperture repo', props: { path: 'C:\\code\\Aperture' } },
    { op: 'create', ref: 'proj', type: 'project', title: 'Aperture' },
    { op: 'create', ref: 'lane', type: 'resource', title: 'Live lane' },
    { op: 'create', ref: 'rule', type: 'decision', title: 'One live lane.', status: 'decided', props: { outcome: 'Only one session drives Rhino.' } },
    { op: 'create', ref: 'live', type: 'task', title: 'Capture probe' },
    { op: 'create', ref: 'offline', type: 'task', title: 'Write unit tests' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Which target?' },
    { op: 'create', ref: 'gated', type: 'task', title: 'Tune the solver' },
    { op: 'link', type: 'software.lives_in', from: 'proj', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'live', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'offline', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'gated', to: 'proj' },
    { op: 'link', type: 'depends_on', from: 'gated', to: 'q' },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
    { op: 'link', type: 'governed_by', from: 'lane', to: 'rule' },
  ]);
}

test('a session registers, takes the lane its task needs, and gives it back when it ends', async () => {
  const l = await fresh();
  const made = await laneSetup(l);

  const one = await sessionStart(l, agent, { task: made.live, cwd: 'c:/code/aperture/src', session_id: 's1' });
  assert.equal(one.status, 'running');
  assert.deepEqual(one.claimed, ['Live lane']);
  assert.equal(one.repo?.title, 'Aperture repo', 'found by a subfolder, whatever the slashes or case');
  assert.equal((await l.proposals()).length, 0, 'operational state needs no approval');
  assert.equal((await sessionStart(l, agent, { session_id: 's1' })).resumed, true, 'announcing twice is safe');

  // A second session wanting the same lane is told who has it, and waits.
  const two = await sessionStart(l, agent, { task: made.live, session_id: 's2' });
  assert.equal(two.status, 'waiting');
  assert.match(two.blocked![0].why, /held by "Session: Capture probe"/);

  await sessionUpdate(l, agent, { run: 's1', note: 'Probe captured; parity is off by 2 px' });
  let view = (await VIEWS.sessions.run(l, {})) as any;
  const first = view.open.find((r: any) => r.id === one.run);
  assert.deepEqual(first.holds.map((h: any) => h.title), ['Live lane']);
  assert.deepEqual(first.working_on.map((w: any) => w.title), ['Capture probe']);
  assert.equal(first.stale, false);
  assert.match((await l.entity(one.run))!.body, /parity is off by 2 px/);

  const ended = await sessionEnd(l, agent, { run: 's1', summary: 'Done' });
  assert.deepEqual([ended.status, ended.released], ['finished', 1]);
  assert.equal((await sessionEnd(l, agent, { run: one.run })).already_ended, true);
  view = (await VIEWS.sessions.run(l, {})) as any;
  assert.deepEqual(view.open.map((r: any) => r.id), [two.run]);
  assert.equal((await l.claim(agent, { resource: made.lane, holder: two.run, reason: 'My turn' })).status, 'claimed');
  await assert.rejects(sessionUpdate(l, agent, { run: one.run, note: 'late' }), /already ended/);
});

test('a project’s open questions are what needs the owner in it, and its next release says where it stands', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Shadows', status: 'active' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Which licence?', status: 'open', props: { options: ['MIT', 'Apache'] } },
    { op: 'link', type: 'part_of', from: 'q', to: 'p' },
    { op: 'create', ref: 'a', type: 'task', title: 'Write the installer', status: 'todo' },
    { op: 'create', ref: 'b', type: 'task', title: 'Sign the package', status: 'done' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'q' },
    { op: 'create', ref: 'r', type: 'software.release', title: 'First release', status: 'upcoming' },
    { op: 'link', type: 'part_of', from: 'r', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'r', to: 'a' },
    { op: 'link', type: 'depends_on', from: 'r', to: 'b' },
    { op: 'create', ref: 'quiet', type: 'project', title: 'Quiet one', status: 'active' },
  ]);
  const asked = await attend(l, { reasons: ['unsettled'], within: made.p });
  assert.deepEqual(asked.items.map((q: any) => [q.title, q.reasons[0].by, q.top.title]), [['Which licence?', 'word', 'Shadows']]);
  assert.deepEqual((await attend(l, { reasons: ['unsettled'], within: made.quiet })).items, []);
  const gate = (await VIEWS.gate.run(l, { event: made.r })) as any;
  const items = gate.streams.flatMap((s: any) => s.items);
  assert.deepEqual([items.filter((i: any) => i.done).length, items.length, items.filter((i: any) => i.blocked).map((i: any) => i.title)], [1, 2, ['Write the installer']]);
});

test('a session tells the story of its work, beat by beat, and can take a beat back', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'a', type: 'task', title: 'Fix the halo' },
    { op: 'create', ref: 'b', type: 'issue', title: 'Labels clip' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
    { op: 'create', ref: 'c', type: 'task', title: 'Unrelated' },
  ]);
  const { run } = await sessionStart(l, agent, { title: 'Storyteller', session_id: 's-story' });
  const one = await tell(l, agent, { run: 's-story', said: 'The halo is blocked by the clipping: fix that first.', links: [{ from: made.b, to: made.a, says: 'is why' }] });
  assert.deepEqual([one.run, one.beat, one.standing], [run, 1, 1]);
  await tell(l, agent, { run, said: 'The unrelated task matters after all.', about: [made.c] });
  const three = await tell(l, agent, { run, said: 'No: it does not.', replaces: 2 });
  assert.equal(three.standing, 2);
  assert.equal((await l.proposals()).length, 0, 'a story needs no approval');
  assert.equal(((await l.events({ target: run })) as any[]).length, 1, 'and logs no event: only the session starting');

  const told = (await VIEWS.story.run(l, { run })) as any;
  assert.deepEqual(told.beats.map((b: any) => [b.n, b.replaced_by ?? null]), [[1, null], [2, 3], [3, null]]);
  // The picture of it is a lens started from the story, the same answer every style draws.
  const drawn = (await VIEWS.lens.run(l, { story: 's-story' })) as any;
  assert.deepEqual(drawn.items.map((i: any) => i.title), ['Labels clip', 'Fix the halo'], 'what only a beat taken back was about drops out; the rest in the order told');
  assert.deepEqual(drawn.items.map((i: any) => i.told), [[1], [1]]);
  assert.deepEqual(drawn.links.map((k: any) => [k.kind, k.says ?? null]), [['said', 'is why']], 'the map’s own link between the two is said by the session’s words');
  assert.deepEqual(drawn.views, [], 'a story is drawn under no view of the workspace');
  assert.match(drawn.said, /What "Storyteller" told of/);
  assert.deepEqual(drawn.controls, [], 'nothing to light it by but what it says');

  // The page opens on the finding: the latest that stands, else the latest beat; its picture is that beat alone.
  assert.equal(told.finding, 3);
  await assert.rejects(tell(l, agent, { run, said: 'Found nothing about anything', finding: true }), /names the items/);
  const found = await tell(l, agent, { run, said: `The halo waits on ${made.b} only; fix that and ${made.a} can go.`, about: [made.a, made.b], finding: true });
  await tell(l, agent, { run, said: 'A later note on the side.', about: [made.c] });
  assert.equal(((await VIEWS.story.run(l, { run })) as any).finding, found.beat, 'a later beat is history under the finding');
  const alone = (await VIEWS.lens.run(l, { story: run, beat: found.beat })) as any;
  assert.deepEqual(alone.items.map((i: any) => i.title).sort(), ['Fix the halo', 'Labels clip']);
  await assert.rejects(VIEWS.lens.run(l, { story: run, beat: 2 }), /No beat 2 stands/);

  await assert.rejects(tell(l, agent, { run, said: 'x'.repeat(281) }), /280 characters/);
  await assert.rejects(tell(l, agent, { run, said: 'About nothing real', about: ['e_nothere1'] }), /No item "e_nothere1"/);
  await assert.rejects(tell(l, agent, { run, said: 'Again', replaces: 2 }), /already taken back/);
  await sessionEnd(l, agent, { run });
  await assert.rejects(tell(l, agent, { run, said: 'Too late' }), /already ended/);
  assert.equal(((await VIEWS.story.run(l, { run })) as any).beats.length, 5, 'the story is still read after the session ends');
});

test('a session that goes quiet is shown as stale', async () => {
  const l = await fresh();
  const { run } = await sessionStart(l, agent, { title: 'Quiet one' });
  await l.db.query(`update entity set props = props || '{"last_seen":"2020-01-01T00:00:00Z"}' where id = $1`, [run]);
  assert.equal(((await VIEWS.sessions.run(l, {})) as any).open[0].stale, true);
  await sessionUpdate(l, agent, { run });
  assert.equal(((await VIEWS.sessions.run(l, {})) as any).open[0].stale, false, 'a heartbeat clears it');
  assert.equal(((await l.events({ target: run })) as any[]).length, 1, 'and leaves no event');
});

test('a brief gathers a task\'s context, blockers, needs and rules', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const holder = await sessionStart(l, agent, { title: 'Other session' });
  await l.claim(agent, { resource: made.lane, holder: holder.run, reason: 'busy' });

  const brief = (await VIEWS.brief.run(l, { task: made.live })) as any;
  assert.equal(brief.repo.path, 'C:\\code\\Aperture');
  assert.deepEqual(brief.needs.map((n: any) => [n.title, n.held_by]), [['Live lane', 'Other session']]);
  assert.deepEqual(brief.rules.map((r: any) => r.title), ['One live lane.']);
  for (const part of ['# Capture probe', 'Part of: Aperture', 'held by Other session', 'Only one session drives Rhino.']) {
    assert.ok(brief.text.includes(part), `expected "${part}" in:\n${brief.text}`);
  }
  const gated = (await VIEWS.brief.run(l, { task: made.gated })) as any;
  assert.deepEqual(gated.root_blockers.map((b: any) => b.title), ['Which target?']);
});

test('the session-start hook registers the session and hands it the repo\'s work and the lane state', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const text = await hookSessionStart(l, { session_id: 'abc', cwd: 'C:\\code\\Aperture' });
  assert.match(text, /registered in Archipelago/);
  const repoId = /Repository: Aperture repo \((e_\w+)\)/.exec(text)?.[1];
  assert.ok(repoId, 'the repository comes with its id');
  assert.match(await hookSessionStart(l, { session_id: 'abc', cwd: 'C:\\code\\Aperture' }), new RegExp(`Repository: Aperture repo \\(${repoId}\\)`), 'a session that is resumed is told its repository again');
  // What the session was told is enough to ask for the repository's work; asked for none, the view says which there are.
  for (const repo of [repoId, 'aperture repo']) assert.equal(((await callTool(l, human, 'view', { name: 'repo_work', params: { repo } })) as any).repo.id, repoId);
  await assert.rejects(async () => callTool(l, human, 'view', { name: 'repo_work', params: {} }), new RegExp(`repo_work needs "repo".*Repositories here: Aperture repo \\(${repoId}\\)`));
  assert.match(text, new RegExp(`Write unit tests \\(${made.offline}\\)`));
  assert.match(text, /Tune the solver .* waiting on: Which target\?/);
  assert.match(text, /"Live lane" .* is free/);

  const other = await sessionStart(l, agent, { title: 'Lane holder' });
  await l.claim(agent, { resource: made.lane, holder: other.run, reason: 'busy' });
  assert.match(await hookSessionStart(l, { session_id: 'def', cwd: 'C:\\elsewhere' }), /does not know a repository[\s\S]*HELD by Lane holder: do not use it/);

  // On another machine the folder is somewhere else: the repository is known by the address it was cloned from, however that is written.
  await make(l, [{ op: 'update', id: repoId!, props: { remote: 'https://github.com/Acme/Aperture' } }]);
  const far = await hookSessionStart(l, { session_id: 'far', cwd: '/home/someone/work/aperture', remote: 'git@github.com:acme/aperture.git' });
  assert.match(far, new RegExp(`Repository: Aperture repo \\(${repoId}\\)`));
  assert.match(far, new RegExp(`Write unit tests \\(${made.offline}\\)`));
  assert.equal(((await VIEWS.sessions.run(l, {})) as any).open.find((r: any) => r.cwd === '/home/someone/work/aperture').repo.id, repoId);
  assert.match(await hookSessionStart(l, { session_id: 'stranger', cwd: '/tmp/x', remote: 'https://github.com/acme/other' }), /does not know a repository for this folder \(a checkout of https:\/\/github\.com\/acme\/other\)/);
  for (const id of ['far', 'stranger']) await hookSessionEnd(l, { session_id: id });

  await hookSessionEnd(l, { session_id: 'abc', reason: 'logout' });
  const open = ((await VIEWS.sessions.run(l, {})) as any).open.map((r: any) => r.title);
  assert.ok(!open.includes('Session in Aperture repo'));
  await hookSessionEnd(l, { session_id: 'never-seen' });
});

test('a session that finishes says where the repository\'s open work stands', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const { run } = await sessionStart(l, agent, { cwd: 'C:\\code\\Aperture', session_id: 'r1' });

  // It did one task and closed it; the other two it has not said a word about.
  await make(l, [{ op: 'update', id: made.offline, status: 'done' }]);
  const asked = (await callTool(l, agent, 'session_end', { run, summary: 'Tests written' })) as any;
  assert.equal(asked.ended, false);
  assert.deepEqual(asked.unreconciled.map((i: any) => i.title).sort(), ['Capture probe', 'Tune the solver'], 'what it changed is not asked about');
  assert.equal((await l.entity(run))!.is_open, true, 'and the session is still open');

  // Vouching for one is not enough; for both, it ends and the run keeps what was said.
  assert.equal(((await callTool(l, agent, 'session_end', { run, still_true: [made.live] })) as any).unreconciled.length, 1);
  const ended = (await callTool(l, agent, 'session_end', { run, summary: 'Tests written', still_true: [made.live, made.gated] })) as any;
  assert.equal(ended.status, 'finished');
  assert.match((await l.entity(run))!.body, /Tests written\nSaid still true: .*Capture probe.*Tune the solver/);
  // Vouching is said on the item as well: an update that changes nothing, which moves when it was last known true.
  // It is the agent's word like any other, so here, where agents' changes are held, it waits for the owner.
  const vouch = (await l.proposals()).at(-1)!;
  assert.deepEqual(vouch.ops, [{ op: 'update', id: made.live }, { op: 'update', id: made.gated }]);
  assert.match(vouch.reason, /still true as written/);
  await l.decide({ kind: 'human', name: 'owner' }, { proposal: vouch.id, approve: true });
  const said = ((await l.events({ target: made.live })) as any[])[0];
  assert.deepEqual([said.action, said.detail.changes], ['entity.update', {}]);

  // What nobody has changed or confirmed for longest comes first, with its age; the session is told of it at the start.
  await l.db.query(`update entity set updated_at = now() - interval '40 days' where id = $1`, [made.gated]);
  await l.db.query(`update entity set updated_at = now() - interval '20 days' where id = $1`, [made.live]);
  const old = await attend(l, { reasons: ['stale'], within: made.repo });
  assert.deepEqual(old.items.map((i: any) => [i.title, i.reasons[0].days]).sort(), [['Capture probe', 20], ['Tune the solver', 40]]);
  assert.equal((await attend(l, { reasons: ['stale'], stale_days: 30 })).items.length, 1, 'only those older than asked for');
  const told = await hookSessionStart(l, { session_id: 'r0', cwd: 'C:\\code\\Aperture' });
  assert.match(told, /Capture probe \(e_\w+\), not confirmed for 20 days/);
  assert.doesNotMatch(told, /Write unit tests.*not confirmed/);
  // Saying it is still true takes it off the list.
  await make(l, [{ op: 'update', id: made.gated }]);
  assert.deepEqual((await attend(l, { reasons: ['stale'] })).items.map((i: any) => i.title), ['Capture probe']);
  await callTool(l, { kind: 'human', name: 'owner' }, 'session_end', { run: 'r0', outcome: 'cancelled' });

  // A scheduled re-check asks what is due: a project says how often, weekly when it does not.
  let due = (await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo } })) as any;
  assert.deepEqual([due.due, due.projects[0].every_days, due.projects[0].items.map((i: any) => i.title)], [true, 7, ['Capture probe']]);
  await make(l, [{ op: 'update', id: made.proj, props: { recheck_days: 30 } }]);
  assert.equal(((await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo } })) as any).due, false, 'nothing here has gone 30 days');
  await make(l, [{ op: 'update', id: made.proj, props: { recheck_days: 0 } }]);
  assert.equal(((await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo } })) as any).due, false, '0 turns it off');
  // Once done, the project waits out its interval again, even with old items left.
  await make(l, [{ op: 'update', id: made.proj, props: { recheck_days: 7 } }]);
  const done = (await callTool(l, agent, 'rechecked', { repo: made.repo, summary: 'One left for the owner' })) as any;
  assert.deepEqual(done.rechecked.map((p: any) => p.title), ['Aperture']);
  due = (await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo } })) as any;
  assert.deepEqual([due.due, typeof due.projects[0].rechecked_at], [false, 'string']);
  await l.db.query(`update entity set props = props || '{"rechecked_at":"2020-01-01T00:00:00Z"}' where id = $1`, [made.proj]);
  assert.equal(((await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo } })) as any).due, true, 'and is due again when it has');
  // Asked for now, it does not wait: the interval and the items' age are set aside.
  await callTool(l, agent, 'rechecked', { repo: made.repo });
  const atOnce = (await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo, now: true } })) as any;
  assert.deepEqual([atOnce.due, atOnce.projects[0].items.length], [true, 2]);
  // An issue filed as about a project, not as part of it, is the repository's work all the same.
  const { drift } = await make(l, [
    { op: 'create', ref: 'drift', type: 'issue', title: 'The carve reads origins' },
    { op: 'link', type: 'about', from: 'drift', to: made.proj },
  ]);
  assert.ok(((await callTool(l, human, 'view', { name: 'repo_work', params: { repo: made.repo } })) as any).ready.some((i: any) => i.id === drift));

  // An open issue in the repository is its work too: shown at the start, asked about at the end.
  const { leak } = await make(l, [
    { op: 'create', ref: 'leak', type: 'issue', title: 'The probe leaks handles' },
    { op: 'link', type: 'part_of', from: 'leak', to: made.proj },
  ]);
  assert.match(await hookSessionStart(l, { session_id: 'r5', cwd: 'C:\\code\\Aperture' }), new RegExp(`- Issue: The probe leaks handles \\(${leak}\\)`));
  assert.ok(((await callTool(l, agent, 'session_end', { run: 'r5' })) as any).unreconciled.some((i: any) => i.id === leak));
  await callTool(l, { kind: 'human', name: 'owner' }, 'session_end', { run: 'r5', outcome: 'cancelled' });
  await make(l, [{ op: 'archive', id: leak }]);

  // A session closed over its head (the hook, a crash) is recorded as not having said.
  await hookSessionStart(l, { session_id: 'r2', cwd: 'C:\\code\\Aperture' });
  await hookSessionEnd(l, { session_id: 'r2', reason: 'exit' });
  const { rows } = await l.db.query<{ body: string }>(`select body from entity where props->>'session_id' = 'r2'`);
  assert.match(rows[0].body, /Session ended \(exit\)\nNot reconciled, open and left unsaid: .*Capture probe/);

  // The human ending one from the UI is not asked, and neither is a session that failed.
  const third = await sessionStart(l, agent, { cwd: 'C:\\code\\Aperture' });
  assert.equal(((await callTool(l, { kind: 'human', name: 'owner' }, 'session_end', { run: third.run, outcome: 'cancelled' })) as any).status, 'cancelled');
  const fourth = await sessionStart(l, agent, { cwd: 'C:\\code\\Aperture' });
  assert.equal(((await callTool(l, agent, 'session_end', { run: fourth.run, outcome: 'failed' })) as any).status, 'failed');
});

test('work that waits on a person is blocked by them, needs them, and is not asked of a session; a session can say it cannot tell', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const { me, sam } = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam' },
  ]);
  await l.db.query(`insert into setting (key, value) values ('me', $1::jsonb)`, [JSON.stringify(me)]);
  // Only a person, company or agent can be waited on: other work is depended on.
  await assert.rejects(l.change(human, { ops: [{ op: 'link', type: 'waits_on', from: made.offline, to: made.live }], reason: 'test' }), /waits_on/);
  await make(l, [
    { op: 'update', id: made.offline, status: 'waiting', owner: sam },
    { op: 'link', type: 'waits_on', from: made.offline, to: me, props: { for: 'saying which framework' } },
  ]);

  // It is blocked, by the person; it needs them though it is not theirs; and its owner is waiting on them.
  const offline = (await attend(l, {})).items.find((b: any) => b.id === made.offline);
  assert.deepEqual(offline.reasons.map((r: any) => [r.why, r.who ?? r.by]), [['waits_on', 'Owner'], ['blocked', ['Owner']]]);
  assert.deepEqual((await attend(l, { person: 'me', reasons: ['waits_on'] })).items.map((e: any) => e.title), ['Write unit tests']);
  assert.deepEqual((await attend(l, { person: sam, reasons: ['blocked'] })).items.map((r: any) => r.reasons[0].by), [['Owner']]);
  assert.ok(!(await attend(l, { reasons: ['ready'] })).items.some((t: any) => t.id === made.offline), 'what waits on a person is not ready');
  const work = (await callTool(l, human, 'view', { name: 'repo_work', params: { repo: made.repo } })) as any;
  assert.deepEqual(work.blocked.find((b: any) => b.id === made.offline).waiting_on, ['Owner']);

  // A session ending there is not asked about it: nothing it did could have settled it.
  const { run } = await sessionStart(l, agent, { cwd: 'C:\\code\\Aperture', session_id: 'w1' });
  const asked = (await callTool(l, agent, 'session_end', { run })) as any;
  assert.deepEqual(asked.unreconciled.map((i: any) => i.title).sort(), ['Capture probe', 'Tune the solver']);
  // What it never looked at it says it cannot tell: that ends it, and the item is left as it was, not marked as checked.
  const before = (await l.entity(made.gated))!.updated_at;
  const ended = (await callTool(l, agent, 'session_end', { run, summary: 'Probe looked at', still_true: [made.live], cannot_tell: [made.gated] })) as any;
  assert.equal(ended.status, 'finished');
  assert.match((await l.entity(run))!.body, /Said still true: Capture probe .*\nCould not tell from here, left as found: Tune the solver/);
  assert.deepEqual((await l.proposals()).at(-1)!.ops, [{ op: 'update', id: made.live }], 'only what was vouched for is said to be checked');
  assert.deepEqual((await l.entity(made.gated))!.updated_at, before);

  // The next session is not asked about what has a change waiting for the owner (the vouching above is one, held),
  // and answers for all it never looked at in one word.
  const next = await sessionStart(l, agent, { cwd: 'C:\\code\\Aperture', session_id: 'w2' });
  const again = (await callTool(l, agent, 'session_end', { run: next.run })) as any;
  assert.deepEqual(again.unreconciled.map((i: any) => i.title), ['Tune the solver']);
  assert.equal(((await callTool(l, agent, 'session_end', { run: next.run, cannot_tell_rest: true })) as any).status, 'finished');
  assert.match((await l.entity(next.run))!.body, /Could not tell from here, left as found: 1 item it did not look at\./);

  // Once they have answered, the link is removed and the work is free again.
  const link = (await l.get(made.offline)).outgoing.find((r: any) => r.type === 'waits_on') as any;
  await make(l, [{ op: 'unlink', relation: link.relation }]);
  assert.ok(((await callTool(l, human, 'view', { name: 'repo_work', params: { repo: made.repo } })) as any).ready.some((i: any) => i.id === made.offline));
});

test('a handoff is read off the map: the note an agent wrote, and what has happened since it was written', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  // With no note, it looks back a week, and says there is none.
  const bare = (await callTool(l, human, 'view', { name: 'handoff', params: { repo: made.repo } })) as any;
  assert.equal(bare.note, null);
  assert.match(bare.how, new RegExp(`^Nobody has written a handoff note for this repository\\. To write the first, create a software\\.handoff and link it software\\.lives_in to ${made.repo}`));
  assert.deepEqual(bare.open.ready.map((i: any) => i.title).sort(), ['Capture probe', 'Write unit tests']);
  assert.deepEqual(bare.open.blocked.map((i: any) => [i.title, i.waiting_on]), [['Tune the solver', ['Which target?']]]);
  assert.match(await hookSessionStart(l, { session_id: 'h0', cwd: 'C:\\code\\Aperture' }), /Where things stand: view "handoff" with repo e_\w+\. Nobody has written a handoff note here/);

  const { note } = await make(l, [
    { op: 'create', ref: 'note', type: 'software.handoff', title: 'Aperture handoff', body: 'Not seen\nThe probe has not been run on a real model.' },
    { op: 'link', type: 'part_of', from: 'note', to: made.proj },
  ]);
  // Everything from here on happened after the note was written.
  await l.db.query(`update entity set updated_at = now() - interval '1 hour', created_at = now() - interval '2 hours' where id = $1`, [note]);
  await l.db.query(`update entity set created_at = now() - interval '2 hours' where id = any($1::text[])`, [[made.live, made.offline, made.gated]]);
  await l.log(l.db, { actor: 'github:someone', action: 'repo.push', target: made.repo, origin: 'github', reason: '1 commit to main: Tests for the solver', detail: { branch: 'main', after: 'abcdef0123456789' } });
  await make(l, [
    { op: 'update', id: made.offline, status: 'done' },
    { op: 'create', ref: 'new', type: 'issue', title: 'The solver diverges on thin walls' },
    { op: 'link', type: 'about', from: 'new', to: made.proj },
  ]);
  await hookSessionEnd(l, { session_id: 'h0', reason: 'exit' });

  const stand = (await callTool(l, human, 'view', { name: 'handoff', params: { repo: 'aperture repo' } })) as any;
  assert.deepEqual([stand.note.id, stand.note.body], [note, 'Not seen\nThe probe has not been run on a real model.']);
  assert.match(stand.how, /^Everything but the note/);
  assert.equal(stand.note.characters, stand.note.body.length);

  // An agent is given a view without what it does not read: no empty fields on a row, and what blocks at the root by name.
  const forPerson = (await callTool(l, human, 'view', { name: 'repo_work', params: { repo: made.repo } })) as any;
  const forAgent = (await callTool(l, agent, 'view', { name: 'repo_work', params: { repo: made.repo } })) as any;
  assert.deepEqual([forPerson.ready[0].due, 'due' in forAgent.ready[0], forAgent.ready[0].id], [null, false, forPerson.ready[0].id]);
  assert.equal(((await callTool(l, agent, 'view', { name: 'repo_work', params: { repo: made.repo, full: true } })) as any).ready[0].due, null, 'whole when asked');
  const blocked = (await callTool(l, agent, 'view', { name: 'attention', params: { reasons: ['blocked'] } })) as any;
  assert.deepEqual([blocked.items[0].reasons[0].why, 'due' in blocked.items[0], 'owner' in blocked.items[0]], ['blocked', false, false], 'an agent is given no empty fields');
  const told = (await callTool(l, agent, 'view', { name: 'handoff', params: { repo: made.repo } })) as any;
  assert.deepEqual([told.note.id, told.open.ready.length, 'ready_count' in told.open], [note, stand.open.ready.length, false], 'a short list is given whole');
  assert.deepEqual(stand.last_push.head, 'abcdef0');
  assert.deepEqual(stand.since_then.pushes.map((p: any) => [p.branch, p.head, p.subject]), [['main', 'abcdef0', '1 commit to main: Tests for the solver']]);
  assert.deepEqual(stand.since_then.settled.map((i: any) => [i.title, i.status]), [['Write unit tests', 'done']]);
  assert.deepEqual(stand.since_then.opened.map((i: any) => i.title), ['The solver diverges on thin walls']);
  assert.deepEqual(stand.since_then.sessions.map((s: any) => [s.status, /^finished: Session ended \(exit\)/.test(s.said) || /Not reconciled/.test(s.said)]), [['finished', true]]);
  assert.ok(!stand.open.ready.some((i: any) => i.title === 'Write unit tests'), 'what is open is as the map has it now, whatever the note says');
  // The next session is told how far the note is behind.
  assert.match(await hookSessionStart(l, { session_id: 'h1', cwd: 'C:\\code\\Aperture' }), /Its note, "Aperture handoff" \(e_\w+\), was written \d{4}-\d\d-\d\d; since then: 1 push, 1 item settled, 1 item opened, 1 session ended\./);
  // Counted from another moment when asked.
  assert.equal(((await callTool(l, human, 'view', { name: 'handoff', params: { repo: made.repo, since: new Date(Date.now() + 60_000).toISOString() } })) as any).since_then.settled.length, 0);

  // A note every session adds to is read by every session after: an agent cannot grow it past its length, only rewrite it.
  const part = 'Next, and why\n' + 'Run the probe on a real model. '.repeat(40);
  const grow = () => callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'update', id: note, append: part }] });
  for (let i = 0; i < 4; i++) await l.change(human, { reason: 'test', ops: [{ op: 'update', id: note, append: part }] });
  await assert.rejects(grow(), /the handoff note would be \d+ characters: 3000 at most[^]*Rewrite it whole/);
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: note, body: 'x'.repeat(2500) }] });
  assert.match(((await callTool(l, human, 'view', { name: 'handoff', params: { repo: made.repo } })) as any).how, /^The note is 2500 of the 3000 characters it may be: there is no room to add to it/);
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: note, append: part.repeat(2) }] });
  assert.match(((await callTool(l, human, 'view', { name: 'handoff', params: { repo: made.repo } })) as any).how, /^The note is \d+ characters, and may be 3000 at most/);
  await assert.rejects(grow(), /3000 at most/);
  // Over its length already, it can always be made shorter.
  const shorter = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'update', id: note, body: 'Next, and why\nRun the probe on a real model.' }] })) as any;
  assert.ok(['applied', 'proposed'].includes(shorter.status));
});

test('a note can name what the same change makes, and an agent can ask for its change to be held', async () => {
  const l = await fresh();
  const { note } = await make(l, [{ op: 'create', ref: 'note', type: 'note', title: 'Handoff', body: 'Open: nothing.' }]);
  const made = await make(l, [
    { op: 'update', id: note, append: 'Next: {t}, as {t} says. Not a ref: {x} and { t }.' },
    { op: 'create', ref: 't', type: 'task', title: 'Connect the repository', body: 'Written up in {t} itself.' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Before {t}?' },
  ]);
  assert.match(made.t, /^e_\w{8}$/);
  // The id is there though the note was written before the item it names, and other braces are left as they were.
  assert.equal((await l.entity(note))!.body, `Open: nothing.\n\nNext: ${made.t}, as ${made.t} says. Not a ref: {x} and { t }.`);
  assert.equal((await l.entity(made.t))!.body, `Written up in ${made.t} itself.`);
  assert.equal((await l.entity(made.q))!.title, `Before ${made.t}?`);
  // Held, a change keeps its refs as written, and they become ids when it is applied.
  const held = (await l.change(agent, { ops: [{ op: 'create', ref: 'n', type: 'note', title: 'Later', body: 'This is {n}.' }], reason: 'test' })) as any;
  const applied = (await l.decide(human, { proposal: held.proposal, approve: true })) as any;
  assert.equal((await l.entity(applied.created.n))!.body, `This is ${applied.created.n}.`);

  // Where agents' changes are applied as made, one that asks to be held waits for the human all the same.
  const free = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto' });
  assert.equal((await free.change(agent, { ops: [{ op: 'update', id: made.t, status: 'doing' }], reason: 'test' })).status, 'applied');
  const asked = await free.change(agent, { ops: [{ op: 'update', id: made.t, status: 'done' }], reason: 'Have a look first', hold: true });
  assert.equal(asked.status, 'proposed');
  assert.equal((await l.entity(made.t))!.status, 'doing');
  assert.equal((await free.change(human, { ops: [{ op: 'update', id: made.t, status: 'done' }], reason: 'test', hold: true })).status, 'applied', 'a human\'s own change is never held');

  // An agent names a thing in a few words: a sentence for a title is refused, on a new thing or an old one. A person names as they like.
  const sentence = 'A session finds its repository by its GitHub address, not by a folder path on one machine';
  await assert.rejects(callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'create', type: 'task', title: sentence }] }), /op 1 \(create\): the title is 89 characters\. A title is a name, not a sentence: 60 at most/);
  await assert.rejects(callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'update', id: made.t, title: sentence }] }), /op 1 \(update\): the title is 89 characters/);
  assert.equal(((await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Find a repository by its remote' }] })) as any).status, 'proposed');
  assert.equal(((await callTool(l, human, 'change', { reason: 'test', ops: [{ op: 'update', id: made.t, title: sentence }] })) as any).status, 'applied');
});

test('a re-check takes a feature that lives in a repository on its own, at its project\'s interval, and leaves out what waits on a person', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'home', type: 'software.repo', title: 'Main repo', props: { path: 'C:\\code\\main' } },
    { op: 'create', ref: 'side', type: 'software.repo', title: 'Add-in repo', props: { path: 'C:\\code\\addin' } },
    { op: 'create', ref: 'proj', type: 'project', title: 'Product', props: { recheck_days: 3 } },
    { op: 'create', ref: 'inside', type: 'software.feature', title: 'Core' },
    { op: 'create', ref: 'addin', type: 'software.feature', title: 'The add-in' },
    { op: 'create', ref: 'old', type: 'task', title: 'Port the ribbon' },
    { op: 'create', ref: 'chore', type: 'task', title: 'Ask for the certificate' },
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'link', type: 'software.lives_in', from: 'proj', to: 'home' },
    { op: 'link', type: 'software.lives_in', from: 'inside', to: 'home' },
    { op: 'link', type: 'software.lives_in', from: 'addin', to: 'side' },
    { op: 'link', type: 'part_of', from: 'inside', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'addin', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'old', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'chore', to: 'addin' },
  ]);
  await l.db.query(`update entity set updated_at = now() - interval '5 days' where id = any($1::text[])`, [[made.old, made.chore]]);
  // In the repository where only the feature lives, it is what is re-checked, as often as its project says.
  let due = (await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.side } })) as any;
  assert.deepEqual(due.projects.map((p: any) => [p.title, p.every_days, p.items.map((i: any) => i.title).sort()]), [['The add-in', 3, ['Ask for the certificate', 'Port the ribbon']]]);
  // Where its project lives too, a feature is that project's and is not listed beside it.
  assert.deepEqual(((await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.home } })) as any).projects.map((p: any) => p.title), ['Product']);
  // What the code cannot tell is said to wait on someone, and is not asked of a re-check again.
  await make(l, [{ op: 'link', type: 'waits_on', from: made.chore, to: made.me, props: { for: 'the certificate' } }]);
  due = (await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.side } })) as any;
  assert.deepEqual(due.projects[0].items.map((i: any) => i.title), ['Port the ribbon']);
  assert.deepEqual(((await callTool(l, agent, 'rechecked', { repo: made.side })) as any).rechecked.map((p: any) => p.title), ['The add-in']);
  assert.equal(((await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.side } })) as any).due, false);
});

test('a secret is sealed with a key that is not in the database, and without that key it reads as not set', async () => {
  const l = await fresh();
  const dir = mkdtempSync(join(tmpdir(), 'pelago-secrets-'));
  configureSecrets(dir);
  await l.setSecret('github_secret', 'whsec-of-the-first-server');
  const stored = (await l.setting<string>('github_secret'))!;
  assert.ok(isSealed(stored) && !stored.includes('whsec'));
  assert.equal(await l.secret('github_secret'), 'whsec-of-the-first-server');
  assert.notEqual(seal('the same words'), seal('the same words'), 'sealed twice, the same secret does not look the same');
  // The key is a file beside the workspaces, made on first use, and is what opens it after a restart.
  assert.equal(Buffer.from(readFileSync(join(dir, 'secrets.key'), 'utf8').trim(), 'base64').length, 32);
  configureSecrets(dir);
  assert.equal(await l.secret('github_secret'), 'whsec-of-the-first-server');
  // A key given in the environment is used for what is sealed from then on; what the file sealed still opens.
  process.env.PELAGO_SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
  await l.setSecret('anthropic_key', 'sk-ant-kept-out-of-the-disk');
  assert.equal(await l.secret('anthropic_key'), 'sk-ant-kept-out-of-the-disk');
  assert.equal(await l.secret('github_secret'), 'whsec-of-the-first-server');
  // On a server with neither key (a backup restored somewhere else), it cannot be opened: it reads as not set, and nothing is given away.
  delete process.env.PELAGO_SECRETS_KEY;
  configureSecrets(mkdtempSync(join(tmpdir(), 'pelago-elsewhere-')));
  assert.equal(await l.secret('anthropic_key'), undefined);
  assert.equal(await l.secret('github_secret'), undefined);
  // Tampered with, a sealed value does not open either.
  configureSecrets(dir);
  assert.equal(unseal(stored.slice(0, -4) + 'AAAA'), undefined);
  // Nor with part of its tag: the first four bytes of the right one are not the right one.
  const [iv, tag, sealedBody] = stored.slice('sealed:v1:'.length).split(':');
  assert.equal(unseal(`sealed:v1:${iv}:${Buffer.from(tag, 'base64').subarray(0, 4).toString('base64')}:${sealedBody}`), undefined);
  await l.setSecret('github_secret', undefined);
  assert.equal(await l.setting('github_secret'), undefined);
  configureSecrets(null);
});

test('launching runs a headless session on a task, holding the lane and recording the outcome', async () => {
  const l = await fresh();
  const dir = mkdtempSync(join(tmpdir(), 'pelago-launch-'));
  // A stand-in for the Claude Code CLI: echoes what it was given, as stream-json.
  const cli = join(dir, 'fake-claude.mjs');
  writeFileSync(
    cli,
    `let prompt = '';
     process.stdin.on('data', (d) => (prompt += d)).on('end', () => {
       const say = (m) => console.log(JSON.stringify(m));
       say({ type: 'system', subtype: 'init', session_id: process.argv[process.argv.indexOf('--session-id') + 1] });
       if (prompt.includes('PLANONLY')) {
         say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'ExitPlanMode', input: { plan: 'The plan: do X then Y' } }] } });
         return setTimeout(() => say({ type: 'result', is_error: false, result: '', num_turns: 2 }), 100);
       }
       setTimeout(() => say({ type: 'result', is_error: prompt.includes('FAIL'), num_turns: 3, total_cost_usd: 0.5,
         result: 'mode=' + process.argv[process.argv.indexOf('--permission-mode') + 1] + ' cwd=' + process.cwd() + ' saw=' + prompt.includes('# Capture probe') + '/' + prompt.includes('cannot edit files') }), 300);
     });`,
  );
  configureLauncher({ mcpUrl: 'http://127.0.0.1:1/mcp', dir: join(dir, 'runs'), command: [process.execPath, cli] });
  const made = await make(l, [
    { op: 'create', ref: 'repo', type: 'software.repo', title: 'Repo', props: { path: dir } },
    { op: 'create', ref: 'proj', type: 'project', title: 'Proj' },
    { op: 'create', ref: 'lane', type: 'resource', title: 'Live lane' },
    { op: 'create', ref: 'live', type: 'task', title: 'Capture probe' },
    { op: 'create', ref: 'homeless', type: 'task', title: 'No repo' },
    { op: 'link', type: 'software.lives_in', from: 'proj', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'live', to: 'proj' },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
  ]);
  const ended = async (run: string) => {
    for (let i = 0; i < 100; i++) {
      const e = (await l.entity(run))!;
      if (!e.is_open) return e;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the launched session never ended');
  };

  await assert.rejects(launch(l, agent, { task: made.live }), /Only a human/);
  await assert.rejects(launch(l, human, { task: made.homeless }), /not linked to a repository/);

  const first = await launch(l, human, { task: made.live });
  assert.deepEqual([first.mode, first.claimed], ['plan', ['Live lane']]);
  // While it runs it holds the lane, so a second launch on the same task is refused.
  await assert.rejects(launch(l, human, { task: made.live }), /Not launched\. "Live lane" is held by "Headless \(plan\): Capture probe"/);

  const done = await ended(first.run);
  assert.equal(done.status, 'finished');
  assert.match(done.body, /mode=plan/);
  assert.match(done.body, /saw=true\/true/, 'the prompt carried the brief and the mode note');
  assert.match(done.body, /3 turns, \$0\.50; transcript: /);
  assert.ok(done.body.toLowerCase().includes(`cwd=${dir}`.toLowerCase()), 'it ran in the repository');
  assert.match(readFileSync(first.transcript, 'utf8'), /"type":"result"/);
  assert.equal((await heldResources(l)).length, 0, 'the lane came back');

  const planned = await ended((await launch(l, human, { task: made.live, instructions: 'PLANONLY' })).run);
  assert.match(planned.body, /finished: The plan: do X then Y/, 'a plan-mode answer is found even though the result is empty');

  const failing = await launch(l, human, { task: made.live, mode: 'acceptEdits', instructions: 'please FAIL' });
  const failed = await ended(failing.run);
  assert.equal(failed.status, 'failed');
  assert.match(failed.body, /mode=acceptEdits/);
});

test('tokens: an estimate is asked for, what a session uses goes to its work, and the graph adds up what is part of what', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Proj' },
    { op: 'create', ref: 'f', type: 'software.feature', title: 'Feature', props: { tokens_estimated: 100_000 } },
    { op: 'create', ref: 'a', type: 'task', title: 'Task A', props: { tokens_estimated: 80_000 } },
    { op: 'create', ref: 'b', type: 'task', title: 'Task B' },
    { op: 'create', ref: 'n', type: 'note', title: 'A note' },
    { op: 'link', type: 'part_of', from: 'f', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'f' },
    { op: 'link', type: 'part_of', from: 'b', to: 'f' },
    { op: 'link', type: 'about', from: 'n', to: 'p' },
  ]);
  const { run } = await sessionStart(l, agent, { session_id: 's1', title: 'Counting' });
  const before = (await l.entity(made.b))!.updated_at;
  // Used with nothing taken on: the session keeps it.
  assert.deepEqual(await recordUsage(l, 's1', 10_000), { run, added: 10_000, to: [] });
  assert.match(((await sessionUpdate(l, agent, { run, task: made.b })) as any).estimate, /"Task B" has no estimate.*tokens_estimated/);
  assert.equal(((await sessionUpdate(l, agent, { run, task: made.a })) as any).estimate, undefined, 'one with an estimate is not asked about');
  // The count is the session's total: only what is new is shared between what it is on.
  assert.deepEqual((await recordUsage(l, 's1', 50_000))!.added, 40_000);
  assert.equal((await recordUsage(l, 's1', 50_000))!.added, 0, 'the same count again adds nothing');
  assert.equal(await recordUsage(l, 'nobody', 5), undefined);
  const props = async (id: string) => (await l.entity(id))!.props;
  assert.deepEqual([(await props(run)).tokens_used, (await props(made.a)).tokens_used, (await props(made.b)).tokens_used], [50_000, 20_000, 20_000]);
  assert.deepEqual((await l.entity(made.b))!.updated_at, before, 'measuring does not make the work look newly confirmed');

  const nodes = new Map(((await VIEWS.graph.run(l, { focus: made.p, depth: 1, relations: 'all', include_closed: true })) as any).nodes.map((n: any) => [n.title, n]));
  const of = (title: string) => nodes.get(title) as any;
  assert.deepEqual(of('Proj').tokens, { estimated: 80_000, used: 40_000, partial: true }, 'a project is what is part of it, in sight or not');
  assert.deepEqual([of('Feature').tokens, of('Feature').estimated], [{ estimated: 80_000, used: 40_000, partial: true }, true], 'a feature is the sum of its tasks, and says when some of them have no estimate');
  assert.deepEqual([of('A note').work, of('A note').tokens], [undefined, undefined], 'what is not work has no tokens');
  // A task linked to its feature and to the project as well is counted once, and a note that is part of a feature is not work.
  await make(l, [{ op: 'link', type: 'part_of', from: made.a, to: made.p }, { op: 'link', type: 'part_of', from: made.n, to: made.f }]);
  const once = ((await VIEWS.graph.run(l, { focus: made.p, depth: 1, relations: 'all', include_closed: true })) as any).nodes;
  assert.deepEqual(once.find((n: any) => n.id === made.p).tokens, { estimated: 80_000, used: 40_000, partial: true });
  // What is finished counts as used: by its estimate when no session was measured on it, and its feature and project with it.
  const { c } = await make(l, [{ op: 'create', ref: 'c', type: 'task', title: 'Task C', status: 'done', props: { tokens_estimated: 30_000 } }, { op: 'link', type: 'part_of', from: 'c', to: made.f }]);
  const again = ((await VIEWS.graph.run(l, { focus: made.f, depth: 1, relations: 'all', include_closed: true })) as any).nodes;
  assert.deepEqual(again.find((n: any) => n.id === c).tokens, { estimated: 30_000, used: 30_000, assumed: true });
  assert.deepEqual(again.find((n: any) => n.id === made.f).tokens, { estimated: 110_000, used: 70_000, assumed: true, partial: true });
  // Its own estimate stands only while none of its tasks has one.
  const { g } = await make(l, [{ op: 'create', ref: 'g', type: 'software.feature', title: 'Bare', props: { tokens_estimated: 50_000 } }, { op: 'create', ref: 'x', type: 'task', title: 'Unsized' }, { op: 'link', type: 'part_of', from: 'x', to: 'g' }]);
  assert.deepEqual(((await VIEWS.graph.run(l, { focus: g, depth: 1, relations: 'all', include_closed: true })) as any).nodes.find((n: any) => n.id === g).tokens, { estimated: 50_000, used: 0 });
  await make(l, [{ op: 'archive', id: c }]);
  await make(l, [{ op: 'update', id: made.b, props: { tokens_estimated: 70_000 } }]);
  assert.equal(((await VIEWS.graph.run(l, { focus: made.f, depth: 1, relations: 'all', include_closed: true })) as any).nodes.find((n: any) => n.id === made.f).tokens.estimated, 150_000);
});

test('a run in GitHub Actions reports what it used, once, and the repository adds it up by where agents ran', async () => {
  const l = await fresh();
  const { repo } = await make(l, [{ op: 'create', ref: 'repo', type: 'software.repo', title: 'Site repo', props: { remote: 'https://github.com/acme/site.git', path: 'C:\\code\\site' } }]);
  const told = { repo: 'acme/site', title: 'Read the push to main (abc1234)', tokens: 42_000.4, cost_usd: 0.31337, turns: 9, link: 'https://github.com/acme/site/actions/runs/1', summary: 'Closed one task.' };
  const first = (await callTool(l, agent, 'run_report', told)) as any;
  assert.equal(first.recorded, true);
  assert.deepEqual(await callTool(l, agent, 'run_report', told), { run: first.run, recorded: false }, 'told twice, recorded once');
  await callTool(l, agent, 'run_report', { repo, title: 'Scheduled re-check', ok: false, tokens: 8_000, link: 'https://github.com/acme/site/actions/runs/2' });
  await assert.rejects(callTool(l, agent, 'run_report', { repo: 'acme/other', title: 'x' }), /No repository "acme\/other"/);
  const run = (await l.entity(first.run))!;
  assert.deepEqual([run.type, run.status, run.is_open, run.props.surface, run.props.tokens_used, run.props.cost_usd, run.props.turns, run.body], ['sys.run', 'finished', false, 'github-actions', 42_000, 0.3134, 9, 'Closed one task.']);
  // A session on a machine in the same repository is counted beside it, apart.
  await sessionStart(l, agent, { session_id: 'local', cwd: 'C:\\code\\site', surface: 'claude-code' });
  await recordUsage(l, 'local', 100_000);
  const usage = (await callTool(l, human, 'view', { name: 'agent_usage', params: { repo: 'Site repo' } })) as any;
  assert.deepEqual(usage.week, { 'claude-code': { runs: 1, tokens: 100_000, cost_usd: 0 }, 'github-actions': { runs: 2, tokens: 50_000, cost_usd: 0.3134 } });
  assert.deepEqual(usage.runs.map((x: any) => [x.title, x.status, x.tokens]).sort(), [['Read the push to main (abc1234)', 'finished', 42_000], ['Scheduled re-check', 'failed', 8_000], ['Session in Site repo', 'running', 100_000]]);
  assert.equal((await l.proposals()).length, 0, 'a report is not a change to review');
});

test('an agent can notify the human; a stale session raises one notification', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Ship it' }]);
  await callTool(l, agent, 'notify', { title: 'Blocked on a certificate', level: 'warning', about: made.t });
  assert.equal((await l.proposals()).length, 0);
  let unread = (await VIEWS.notifications.run(l, {})) as any[];
  assert.deepEqual([unread[0].title, unread[0].level, unread[0].from, unread[0].about_title], ['Blocked on a certificate', 'warning', 'agent:test', 'Ship it']);

  const lane = (await make(l, [{ op: 'create', ref: 'lane', type: 'resource', title: 'Live lane' }])).lane;
  const { run } = await sessionStart(l, agent, { title: 'Quiet one' });
  await l.claim(agent, { resource: lane, holder: run, reason: 'busy' });
  const silent = (id: string, hours: number) => l.db.query(`update entity set props = props || jsonb_build_object('last_seen', $2::text) where id = $1`, [id, new Date(Date.now() - hours * 3_600_000).toISOString()]);
  await silent(run, 1);
  // One that holds nothing is not worth a notice: it ends by itself.
  const idle = (await sessionStart(l, agent, { title: 'Idle one' })).run;
  await silent(idle, 1);
  const autos = new Automations(l);
  await autos.tick();
  await autos.tick();
  unread = (await VIEWS.notifications.run(l, {})) as any[];
  const stale = unread.filter((n) => n.title.includes('gone quiet'));
  assert.equal(stale.length, 1, 'told once, not every pass');
  assert.match(stale[0].body, /still holds: Live lane/);

  // Heard from again, the notice is no longer true and leaves what there is to read; quiet again, it is told again; ended, it leaves again.
  const quiet = async () => ((await VIEWS.notifications.run(l, {})) as any[]).filter((n) => n.title.includes('gone quiet')).length;
  await sessionUpdate(l, agent, { run });
  assert.equal(await quiet(), 0, 'withdrawn when the session reports in');
  await silent(run, 1);
  await autos.tick();
  assert.equal(await quiet(), 1, 'told again when it goes quiet again');
  // Half a day without a word, a session is ended for it: the notice goes, and what it held is given back.
  assert.equal((await l.entity(idle))!.is_open, true, 'an hour is not half a day');
  await silent(run, 13);
  await silent(idle, 13);
  await autos.tick();
  const gone = (await l.entity(run))!;
  assert.deepEqual([gone.status, (await l.entity(idle))!.status], ['finished', 'finished']);
  assert.match(gone.body, /Not heard from for over 12 hours: ended for it/);
  assert.equal(await quiet(), 0, 'withdrawn when the session ends');
  assert.equal((await heldResources(l)).length, 0, 'the lane is free');
  assert.equal(((await VIEWS.notifications.run(l, {})) as any[]).length, 1, 'other notifications are left alone');
});

test('automations fire on a schedule and on events, are logged, and cannot trigger each other', async () => {
  const l = await fresh();
  await assert.rejects(
    make(l, [{ op: 'create', type: 'sys.automation', title: 'Half-made', status: 'enabled', props: { trigger: 'every', action: 'tool', tool: 'decide' } }]),
    /needs every_minutes[\s\S]*tool to be one of: check_connections, import_audit/,
  );
  // An agent can only propose one.
  const proposed = await l.change(agent, { reason: 'test', ops: [{ op: 'create', type: 'sys.automation', title: 'Sneaky', status: 'enabled', props: { trigger: 'every', every_minutes: 1, action: 'notify' } }] });
  assert.equal(proposed.status, 'proposed');

  const made = await make(l, [
    { op: 'create', ref: 'hourly', type: 'sys.automation', title: 'Check connections', status: 'enabled', props: { trigger: 'every', every_minutes: 60, action: 'tool', tool: 'check_connections' } },
    { op: 'create', ref: 'morning', type: 'sys.automation', title: 'Morning nudge', status: 'enabled', props: { trigger: 'daily', at: '09:00', action: 'notify', message: 'Review the map' } },
    { op: 'create', ref: 'review', type: 'sys.automation', title: 'New proposal', status: 'enabled', props: { trigger: 'event', on_action: 'proposal.create', action: 'notify', message: 'Proposal from {actor}: {reason}', level: 'warning' } },
    { op: 'create', ref: 'any', type: 'sys.automation', title: 'Everything', status: 'paused', props: { trigger: 'event', on_action: 'entity.*', action: 'notify' } },
  ]);
  // Nor where agents' other changes are applied as made: an automation acts later with a human's authority, so
  // making one, changing one or bringing one back waits for the human.
  const loose = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', archive: 'auto', restore: 'auto', link: 'auto' });
  const launches = { trigger: 'every', every_minutes: 1, action: 'launch', input: { task: made.hourly, mode: 'acceptEdits', instructions: 'anything' } };
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'create', type: 'task', title: 'An ordinary thing' }] })).status, 'applied');
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'create', type: 'sys.automation', title: 'Launches', status: 'enabled', props: launches }] })).status, 'proposed');
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.morning, props: launches }] })).status, 'proposed');
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.any, status: 'enabled' }] })).status, 'proposed');
  const autos = new Automations(l);
  const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m);
  const fired = async (when: Date) => (await autos.tick(when)).map((f) => f.automation).sort();

  assert.deepEqual(await fired(at(8)), [made.hourly], 'interval fires at once; daily waits for its time; events start from now');
  assert.deepEqual(await fired(at(8, 30)), []);
  assert.deepEqual(await fired(at(9, 1)), [made.hourly, made.morning].sort());
  assert.deepEqual(await fired(at(9, 30)), [], 'daily fires once a day');
  assert.deepEqual(await fired(new Date(2026, 9, 8, 9, 0)), [made.hourly, made.morning].sort());

  await l.change(agent, { reason: 'Found a bug', ops: [{ op: 'create', type: 'software.bug', title: 'Crash' }] });
  assert.deepEqual(await fired(new Date(2026, 9, 8, 9, 5)), [made.review]);
  const unread = (await VIEWS.notifications.run(l, {})) as any[];
  assert.ok(unread.some((n) => n.title === 'Proposal from agent:test: Found a bug' && n.level === 'warning'));

  // Unpause the catch-all: the notifications automations create must not set it off.
  await make(l, [{ op: 'update', id: made.any, status: 'enabled' }]);
  await autos.tick(new Date(2026, 9, 8, 9, 6));
  const before = ((await VIEWS.notifications.run(l, {})) as any[]).length;
  assert.deepEqual(await fired(new Date(2026, 9, 8, 9, 7)), []);
  assert.equal(((await VIEWS.notifications.run(l, {})) as any[]).length, before);

  const hourly = (await l.entity(made.hourly))!;
  assert.match(hourly.props.last_result as string, /^ok: \[\]/);
  const log = (await l.events({ target: made.hourly })) as any[];
  assert.equal(log.filter((e) => e.action === 'automation.fire').length, 3);
  assert.equal(log[0].actor, `agent:automation:${made.hourly}`);
});

test('a note is added to, or one passage of it replaced, without sending it again', async () => {
  const { undo } = await import('../src/undo.ts');
  const l = await fresh();
  const note = 'Seen\n- once, on Monday.\n\nWhat would help\nA smaller answer.';
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Trim the answer', body: note }]);
  const body = async () => (await l.entity(t))!.body;

  const added = await l.change(human, { reason: 'test', ops: [{ op: 'update', id: t, status: 'done', append: 'Outcome\nTrimmed to a tenth.\n' }] });
  assert.equal(await body(), `${note}\n\nOutcome\nTrimmed to a tenth.`, 'after a blank line, the rest untouched');

  await make(l, [{ op: 'update', id: t, replace: { find: '- once, on Monday.', with: '- twice: Monday and $& Tuesday.' }, append: 'Checked again.' }]);
  assert.equal(await body(), `${note.replace('once, on Monday', () => 'twice: Monday and $& Tuesday')}\n\nOutcome\nTrimmed to a tenth.\n\nChecked again.`, 'what replaces it is taken as written');

  const before = await body();
  const refused = (ops: Op[], why: RegExp) => assert.rejects(l.change(human, { reason: 'test', ops }), why);
  await refused([{ op: 'update', id: t, replace: { find: 'not in the note', with: 'x' } }], /"Trim the answer": replace\.find must be in the note exactly once, and is there not at all/);
  await refused([{ op: 'update', id: t, replace: { find: '\n\n', with: 'x' } }], /is there 3 times/);
  await refused([{ op: 'update', id: t, body: 'All new', append: 'and more' }], /not both/);
  assert.equal(await body(), before, 'a refused change leaves the note alone');

  // A part of a note held for review is checked again when it is approved: the note may have moved on.
  const held = await l.change(agent, { reason: 'test', ops: [{ op: 'update', id: t, replace: { find: 'Checked again.', with: 'Checked twice.' } }] });
  assert.equal(held.status, 'proposed');
  await make(l, [{ op: 'update', id: t, replace: { find: 'Checked again.', with: 'Checked.' } }]);
  await assert.rejects(l.decide(human, { proposal: (held as { proposal: string }).proposal, approve: true }), /is there not at all/);

  await undo(l, human, { changeset: (added as { changeset: string }).changeset });
  assert.equal((await l.entity(t))!.status, 'todo', 'undone like any other edit');

  // An agent reading history is given the start of a long note and its length; the whole of it when it asks, and a person always.
  const long = 'A long note. '.repeat(100);
  await make(l, [{ op: 'update', id: t, body: long }]);
  const to = (answer: any) => (answer.recent_events ?? answer)[0].detail.changes.body.to as string;
  for (const tool of ['get', 'events']) {
    const input = tool === 'get' ? { id: t, history: true } : { target: t };
    assert.match(to(await callTool(l, agent, tool, input)), /^A long note\. .{180,200}… \(1300 characters; ask again with full: true/, tool);
    assert.equal(to(await callTool(l, agent, tool, { ...input, full: true })), long, `${tool}, in full`);
    assert.equal(to(await callTool(l, human, tool, input)), long, `${tool}, for a person`);
  }
  assert.equal(((await callTool(l, agent, 'get', { id: t })) as any).entity.body, long, 'the note itself is always whole');
  // An agent that asks for an item is given the item: its history comes when asked for.
  assert.equal(((await callTool(l, agent, 'get', { id: t })) as any).recent_events, undefined);
  assert.ok(((await callTool(l, human, 'get', { id: t })) as any).recent_events.length);
});

test('a refused change is kept and corrected by its one wrong op; history says a change set’s reason once', async () => {
  const l = await fresh();
  const ops = [
    { op: 'create', ref: 'a', type: 'task', title: 'Draw the plan' },
    { op: 'create', ref: 'b', type: 'issue', title: 'The plan is drawn twice', props: { repro: 'Open it twice' } },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
  ];
  // The refusal names the flavour that has the field, and the name the change is kept under.
  const said = await callTool(l, agent, 'change', { ops, reason: 'A plan to draw' }).then(
    () => assert.fail('an issue has no repro'),
    (e: Error) => e.message,
  );
  assert.match(said, /op 2 \(create\): issue has no field "repro".*software\.bug, a flavour of issue, has it/);
  const name = /kept for 10 minutes as "(k_\w+)"/.exec(said)![1];
  // A fix that is wrong again is refused again, under the same name.
  await assert.rejects(callTool(l, agent, 'change', { retry: name, fixes: [{ at: 2, op: { ...ops[1], title: 'x'.repeat(61) } }] }), new RegExp(`the title is 61 characters[^]*as "${name}"`));
  await assert.rejects(callTool(l, agent, 'change', { retry: name, fixes: [{ at: 9, op: null }] }), /no op 9/);
  // The name finds it, whatever the session calls itself this time.
  const sent = (await callTool(l, { ...agent, name: 'test/claude-code:elsewhere' }, 'change', { retry: name, fixes: [{ at: 2, op: { ...ops[1], type: 'software.bug' } }] })) as any;
  assert.equal(sent.status, 'proposed');
  const held = (await l.proposals()).at(-1)!;
  assert.equal(held.reason, 'A plan to draw');
  assert.deepEqual(held.ops.map((o: any) => o.type), ['task', 'software.bug', 'depends_on']);
  // Once it has gone through it is no longer kept; nor is it anyone else's to send.
  await assert.rejects(callTool(l, agent, 'change', { retry: name }), /No refused change is kept/);
  await assert.rejects(callTool(l, agent, 'change', { reason: 'nothing' }), /needs ops/);

  // What changed since: one change set says its reason and authority on the first of its events, and long notes are cut.
  const long = 'A long note. '.repeat(100);
  const made = await make(l, [
    { op: 'create', ref: 'x', type: 'task', title: 'First', body: long },
    { op: 'create', ref: 'y', type: 'task', title: 'Second' },
  ]);
  await make(l, [{ op: 'update', id: made.x, body: `${long}More.` }]);
  const since = { name: 'changed_since', params: { since: '2000-01-01' } };
  const events = ((await callTool(l, agent, 'view', since)) as any).events as any[];
  assert.match(events[0].detail.changes.body.to, /ask again with full: true/);
  const set = events.filter((e) => e.changeset === events.at(-1).changeset || e.target_id === made.y || e.target_id === made.x).filter((e) => e.action === 'entity.create');
  assert.deepEqual(set.map((e) => typeof e.reason), ['string', 'undefined'], 'the reason once');
  const whole = ((await callTool(l, agent, 'view', { ...since, params: { ...since.params, full: true } })) as any).events as any[];
  assert.ok(whole.every((e) => typeof e.reason === 'string'));
  assert.equal(whole[0].detail.changes.body.to, `${long}More.`);
});

test('undo reverses a change set as a new change, and leaves later edits alone', async () => {
  const { undo } = await import('../src/undo.ts');
  const l = await fresh();
  const base = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Proj' },
    { op: 'create', ref: 'old', type: 'task', title: 'Old task', body: 'x'.repeat(500), props: { priority: 'low' } },
    { op: 'link', type: 'part_of', from: 'old', to: 'p' },
  ]);
  const rel = (await l.get(base.old)).outgoing[0] as any;
  const second = await l.change(human, {
    reason: 'Reshuffle',
    ops: [
      { op: 'create', ref: 'n', type: 'task', title: 'New task' },
      { op: 'link', type: 'part_of', from: 'n', to: base.p },
      { op: 'update', id: base.old, status: 'doing', body: 'short', props: { priority: 'high', due: '2026-12-01' } },
      { op: 'unlink', relation: rel.relation },
      { op: 'archive', id: base.p },
    ],
  });
  const set = (second as { changeset: string }).changeset;
  // Someone changes one of those fields again before the undo.
  await make(l, [{ op: 'update', id: base.old, props: { priority: 'urgent' } }]);

  // An agent's undo is a proposal like any other change.
  assert.equal((await undo(l, agent, { changeset: set })).status, 'proposed');

  const result = await undo(l, human, { changeset: set });
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.skipped, ['"Old task": priority has changed again since, so it was left as it is']);
  const old = (await l.entity(base.old))!;
  assert.deepEqual([old.status, old.body.length, old.props.priority, old.props.due], ['todo', 500, 'urgent', undefined], 'long text comes back whole');
  assert.equal((await l.entity(base.p))!.archived_at, null, 'the archived project is restored');
  assert.deepEqual((await l.get(base.old)).outgoing.map((r: any) => r.title), ['Proj'], 'the removed link is back');
  assert.deepEqual((await l.search({ type: 'task' })).map((t) => t.title), ['Old task'], 'the created task is archived');

  await assert.rejects(undo(l, human, { changeset: set }), /already been undone/);
  await assert.rejects(undo(l, human, { changeset: 'c_nope' }), /No change set/);
  // Undoing the undo puts the second change back.
  await undo(l, human, { changeset: (result as { changeset: string }).changeset });
  assert.equal((await l.entity(base.old))!.status, 'doing');
});

test('the graph view returns a preset of the whole map, or one entity\'s neighbourhood', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Proj' },
    { op: 'create', ref: 'a', type: 'task', title: 'A' },
    { op: 'create', ref: 'b', type: 'software.bug', title: 'B' },
    { op: 'create', ref: 'c', type: 'task', title: 'C', status: 'done' },
    { op: 'create', ref: 'lonely', type: 'note', title: 'Lonely' },
    { op: 'create', ref: 'far', type: 'task', title: 'Far' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'far', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'c' },
  ]);
  const titles = (g: any) => g.nodes.map((n: any) => n.title).sort();

  const blocking = (await VIEWS.graph.run(l, {})) as any;
  assert.deepEqual(titles(blocking), ['A', 'B'], 'only what blocking relations connect; finished work left out');
  assert.deepEqual(blocking.edges.map((e: any) => e.type), ['depends_on']);
  const a = blocking.nodes.find((n: any) => n.title === 'A');
  assert.deepEqual([a.blocked, a.root], [true, 'task']);
  assert.equal(blocking.nodes.find((n: any) => n.title === 'B').root, 'issue', 'a flavour reports its root type');

  assert.deepEqual(titles(await VIEWS.graph.run(l, { relations: 'all', include_closed: true })), ['A', 'B', 'C', 'Far', 'Proj']);
  assert.deepEqual(titles(await VIEWS.graph.run(l, { focus: made.far, depth: 1 })), ['Far', 'Proj']);
  assert.deepEqual(titles(await VIEWS.graph.run(l, { focus: made.far, depth: 2 })), ['A', 'Far', 'Proj']);
  assert.deepEqual(titles(await VIEWS.graph.run(l, { focus: made.lonely })), ['Lonely'], 'a focus is shown even with no relations');
  await assert.rejects(VIEWS.graph.run(l, { relations: 'everything' }), /must be one of/);
});

test('a lens answers with one shape of data: what is inside what, the same counts at every depth, links moved up, and what was left out', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'P' },
    { op: 'create', ref: 'q', type: 'project', title: 'Q' },
    { op: 'create', ref: 'late', type: 'software.feature', title: 'Late', props: { order: 2 } },
    { op: 'create', ref: 'early', type: 'software.feature', title: 'Early', status: 'building', props: { order: 1 } },
    { op: 'create', ref: 'a', type: 'task', title: 'A' },
    { op: 'create', ref: 'b', type: 'task', title: 'B' },
    { op: 'create', ref: 'c', type: 'task', title: 'C' },
    { op: 'create', ref: 'd', type: 'task', title: 'D' },
    { op: 'create', ref: 'e', type: 'task', title: 'E', status: 'done' },
    { op: 'create', ref: 'x', type: 'task', title: 'X' },
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam' },
    { op: 'link', type: 'part_of', from: 'early', to: 'p' },
    { op: 'link', type: 'part_of', from: 'late', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'early' },
    { op: 'link', type: 'part_of', from: 'b', to: 'early' },
    { op: 'link', type: 'part_of', from: 'e', to: 'early' },
    { op: 'link', type: 'part_of', from: 'c', to: 'p' },
    { op: 'link', type: 'part_of', from: 'x', to: 'q' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'c' },
    { op: 'link', type: 'depends_on', from: 'x', to: 'a' },
    { op: 'link', type: 'waits_on', from: 'b', to: 'sam' },
  ]);
  const run = async (params: Record<string, unknown> = {}) => (await VIEWS.lens.run(l, params)) as any;
  const titles = (answer: any) => answer.items.map((i: any) => i.title).sort();
  const item = (answer: any, title: string) => answer.items.find((i: any) => i.title === title);
  const name = (answer: any, id: string) => answer.items.find((i: any) => i.id === id)?.title;
  const links = (answer: any) => answer.links.map((k: any) => `${name(answer, k.from)} ${k.kind} ${name(answer, k.to)} x${k.n}`).sort();

  // The whole map, as it opens: what is finished and what the organising link does not touch are counted, not sent.
  const whole = await run();
  assert.deepEqual(titles(whole), ['A', 'B', 'C', 'Early', 'Late', 'P', 'Q', 'X']);
  assert.deepEqual([whole.rest.closed, whole.rest.unlinked], [1, 2], 'E is finished; D and Sam are part of nothing');
  assert.deepEqual([whole.lens.by, whole.lens.over, whole.lens.fold], ['part_of', ['depends_on', 'waits_on'], ['closed', 'system', 'unlinked']], 'the lens as it was read comes back');
  assert.deepEqual(Object.keys(item(whole, 'P')), Object.keys(item(whole, 'A')), 'a thing with parts carries the same keys as one without');
  assert.deepEqual(Object.keys(item(whole, 'P').within), Object.keys(item(whole, 'A').within));
  assert.deepEqual([item(whole, 'P').inside, item(whole, 'Early').inside, item(whole, 'A').inside], [null, made.p, made.early]);
  const inP = item(whole, 'P').within;
  assert.deepEqual([inP.items, inP.blocked, inP.waiting, inP.waits_on, inP.not_sent], [5, 2, 1, { [made.sam]: 1 }, 0], 'what is inside it, counted as each says of itself');
  assert.deepEqual([item(whole, 'A').state.blocked, item(whole, 'B').state.waits_on, item(whole, 'C').state.blocked], [true, [made.sam], false]);
  assert.deepEqual(['Early', 'Late', 'C'].map((t) => item(whole, t).place), [1, 2, 3], 'beside each other by the ordering field, then as written down');
  assert.deepEqual(links(whole), ['A depends_on C x1', 'X depends_on A x1'], 'a link to what was not sent is not sent');

  // One step down: what was cut is still counted, and its links are moved up to what stands for it.
  const near = await run({ far: 1 });
  assert.deepEqual(titles(near), ['C', 'Early', 'Late', 'P', 'Q', 'X']);
  assert.equal(near.rest.far, 2);
  assert.deepEqual([item(near, 'Early').within.items, item(near, 'Early').within.not_sent, item(near, 'Early').within.blocked], [2, 2, 2]);
  assert.deepEqual(links(near), ['Early depends_on C x1', 'X depends_on Early x1']);

  // Around one item: what is inside it, and whatever any kind of link ties to those, filed by the link that ties it to the start.
  const around = await run({ from: made.early, over: 'all', lanes: 'link' });
  assert.deepEqual(titles(around), ['A', 'B', 'C', 'Early', 'P', 'Sam', 'X']);
  assert.deepEqual(['A', 'P', 'C'].map((t) => item(around, t).lane), ['part_of:in', 'part_of', null], 'the kind of link and which way it runs');
  const asItOpens = await run({ from: made.early });
  assert.deepEqual([asItOpens.lens.over, asItOpens.lens.lanes, titles(asItOpens)], ['all', 'link', titles(around)], 'around one item, every kind of link and lanes by link are what it opens on');
  await make(l, [{ op: 'create', ref: 'n', type: 'note', title: 'About A' }, { op: 'link', type: 'about', from: 'n', to: made.a }, { op: 'create', ref: 'm', type: 'note', title: 'About Early' }, { op: 'link', type: 'about', from: 'm', to: made.early }]);
  assert.deepEqual(titles(await run({ from: made.early })).filter((t: string) => t.startsWith('About')), ['About Early'], 'what is linked to the start is brought in; what is only linked to something inside it is not');
  assert.deepEqual(links(around), ['A depends_on C x1', 'B waits_on Sam x1', 'X depends_on A x1'], 'what is inside what is said by inside, not by a link as well');

  // Lanes by stage, with what is finished unfolded; and kinds.
  const staged = await run({ from: made.p, lanes: 'stage', fold: [] });
  assert.deepEqual(['Early', 'Late', 'E'].map((t) => item(staged, t).lane), ['under_way', 'to_come', 'done']);
  const tasks = await run({ kinds: ['task'], fold: ['closed', 'system'] });
  assert.deepEqual([titles(tasks), tasks.rest.kinds], [['A', 'B', 'C', 'D', 'X'], 7], 'the two projects, two features, Sam and the two notes are not tasks');
  const tasksOfP = await run({ from: made.p, kinds: ['task'], over: [] });
  assert.deepEqual([titles(tasksOfP), item(tasksOfP, 'A').inside, item(tasksOfP, 'P').within.items], [['A', 'B', 'C', 'P'], made.p, 3], 'of some kinds only, a thing sits in the nearest thing kept above it: the feature between is not drawn, and its tasks are not lost');

  await assert.rejects(run({ by: 'nope' }), /unknown kind of link/);
  await assert.rejects(run({ fold: ['everything'] }), /fold must be of/);
  await assert.rejects(run({ from: 'e_nothing0' }), /No entity/);

  // Kept on the map: the workspace's lens and style (about nothing), then those about what the picture starts from, then what is asked.
  assert.deepEqual([whole.style, whole.kept], [{}, { lens: [], style: [] }]);
  const drawn = await make(l, [
    { op: 'create', ref: 'wl', type: 'lens', title: 'As it opens', props: { far: 1 } },
    { op: 'create', ref: 'pl', type: 'lens', title: 'P in full', props: { far: 2, over: ['depends_on'] } },
    { op: 'create', ref: 'ws', type: 'style', title: 'House style', props: { shape: 'boxes', open: 1, colors: { sea: '#f0f4f5' } } },
    { op: 'create', ref: 'ps', type: 'style', title: 'P opened', props: { open: 2 } },
    { op: 'create', ref: 'spare', type: 'style', title: 'Spare', status: 'retired', props: { shape: 'nest' } },
    { op: 'link', type: 'about', from: 'pl', to: made.p },
    { op: 'link', type: 'about', from: 'ps', to: made.p },
  ]);
  const opened = await run();
  assert.deepEqual([opened.lens.far, titles(opened), opened.style], [1, ['C', 'Early', 'Late', 'P', 'Q', 'X'], { shape: 'boxes', open: 1, colors: { sea: '#f0f4f5' } }], 'the workspace’s own, and they are not items of the picture');
  assert.deepEqual(opened.kept, { lens: [{ id: drawn.wl, title: 'As it opens' }], style: [{ id: drawn.ws, title: 'House style' }] });
  const ofP = await run({ from: made.p });
  assert.deepEqual([ofP.lens.far, ofP.lens.over, ofP.style.open, ofP.style.shape], [2, ['depends_on'], 2, 'boxes'], 'a field the nearer one names replaces it; one it does not falls through');
  assert.deepEqual(ofP.kept.style.map((k: any) => k.title), ['House style', 'P opened']);
  assert.equal((await run({ from: made.p, far: 0 })).lens.far, 0, 'what is asked for the moment weighs most');
  assert.equal((await run({ style: drawn.spare })).style.shape, 'nest', 'a style named outright is used, retired or not');
  await assert.rejects(run({ style: 'e_nothing0' }), /No style/);
  // Each lens about an item is a view of it, in order; one that starts somewhere else is a shortcut; and the lens is said in words.
  const more = await make(l, [
    { op: 'create', ref: 'road', type: 'lens', title: 'Roadmap', props: { place: 1, kinds: ['software.feature'], far: 1, controls: ['lit', 'far', 'nonsense'] } },
    { op: 'create', ref: 'go', type: 'lens', title: 'Go to Q', props: { place: 9, from: made.q, far: 0 } },
    { op: 'link', type: 'about', from: 'road', to: made.p },
    { op: 'link', type: 'about', from: 'go', to: made.p },
  ]);
  const hubP = await run({ from: made.p });
  assert.deepEqual(hubP.views.map((v: any) => [v.title, v.to?.title]), [['Roadmap', undefined], ['Go to Q', 'Q'], ['P in full', undefined], ['Around it', undefined], ['As it opens', undefined]], 'its own by place, then those with none, then what it is tied to, then the workspace\u2019s: every lens that applies can be chosen');
  assert.equal((await run({ from: made.p, lens: drawn.wl })).lens.far, 1, 'the workspace\u2019s view, chosen for this item');
  assert.deepEqual([hubP.view, hubP.lens.kinds, hubP.controls, titles(hubP)], [more.road, ['software.feature'], ['lit', 'far'], ['Early', 'Late', 'P']], 'it opens on the first');
  assert.equal((await run({ from: made.p, lens: drawn.pl })).lens.far, 2, 'another view is asked for by its id');
  const gone = await run({ from: made.p, lens: more.go });
  assert.deepEqual([gone.lens.from, titles(gone), gone.view], [made.q, ['Q'], more.go], 'a shortcut is a view that starts somewhere else, tightly scoped');
  assert.match(hubP.said, /^"P" and what is part of it; 1 step down; only software\.feature; .*without what is finished/);
  assert.deepEqual([(await run()).views, (await run()).view], [[{ id: drawn.wl, title: 'As it opens' }], drawn.wl], 'the whole map has the workspace\u2019s views');
  // An item with no picture of its own opens on what it is tied to: not on a view of the workspace's, and never on a shortcut.
  const plainQ = await run({ from: made.q });
  assert.deepEqual([plainQ.view, plainQ.lens.over, plainQ.lens.lanes, plainQ.views.map((v: any) => v.title)], ['around', 'all', 'link', ['Around it', 'As it opens']]);
  assert.equal((await run({ from: made.q, lens: 'around' })).view, 'around', 'asked for by name');
  assert.equal((await run({ from: made.q, lens: drawn.wl })).view, drawn.wl, 'the workspace\u2019s view can still be chosen');
  const onlyShortcut = await make(l, [
    { op: 'create', ref: 's', type: 'lens', title: 'To P', props: { from: made.p, far: 0 } },
    { op: 'link', type: 'about', from: 's', to: made.q },
  ]);
  assert.equal((await run({ from: made.q })).view, 'around', 'a shortcut is never what an item opens on');
  await make(l, [{ op: 'archive', id: onlyShortcut.s }]);

  // A hub is an item that holds enough to need views of its own: how much is enough is its project's to say.
  assert.deepEqual([hubP.hub, ((await VIEWS.hubs.run(l, {})) as any).hubs], [{ is: false }, []], 'six things are not twelve');
  await make(l, [{ op: 'update', id: made.p, props: { hub_at: 2 } }]);
  const found = ((await VIEWS.hubs.run(l, {})) as any).hubs.map((h: any) => [h.title, h.inside, h.at, h.views]);
  assert.deepEqual(found, [['P', 5, 2, 3], ['Early', 2, 2, 0]], 'while a project is shaped, most of what is in it is a hub; Q is another project and keeps the usual size');
  assert.deepEqual((await run({ from: made.early })).hub, { is: true, inside: 2, at: 2 });

  // Code in a style runs in the browser of whoever looks: an agent that writes it proposes it, whatever else agents may do unreviewed.
  const free = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', merge: 'auto' });
  const plain = await free.change(agent, { reason: 'a colour', ops: [{ op: 'update', id: drawn.ws, props: { radius: 4 } }] });
  const coded = await free.change(agent, { reason: 'a drawing', ops: [{ op: 'update', id: drawn.ws, props: { code: 'export default () => {}' } }] });
  const born = await free.change(agent, { reason: 'a drawing', ops: [{ op: 'create', type: 'style', title: 'Mine', props: { code: 'export default () => {}' } }] });
  const folded = await free.change(agent, { reason: 'fold', ops: [{ op: 'merge', keep: drawn.ws, drop: drawn.spare }] });
  assert.deepEqual([plain.status, coded.status, born.status, folded.status], ['applied', 'proposed', 'proposed', 'proposed']);
  assert.equal((await run()).style.code, undefined, 'and until the human approves it, the picture is drawn without it');
  assert.equal((await free.change(human, { reason: 'mine', ops: [{ op: 'update', id: drawn.ws, props: { code: 'export default () => {}' } }] })).status, 'applied');
  await make(l, [{ op: 'update', id: drawn.ws, props: { code: null, radius: null } }]);
  assert.deepEqual([await pictureOf(l, drawn.ps), await pictureOf(l, drawn.ws), await pictureOf(l, made.a)], [`graph?from=${made.p}`, 'graph?lens', undefined], 'a style is seen at work in the picture it is about');
});

test('the roadmap tree orders a project\'s features, rolls up progress, and shows where work is happening', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Proj' },
    { op: 'create', ref: 'other', type: 'project', title: 'Other' },
    { op: 'create', ref: 'late', type: 'software.feature', title: 'Late', props: { order: 2 } },
    { op: 'create', ref: 'early', type: 'software.feature', title: 'Early', status: 'building', props: { order: 1 } },
    { op: 'create', ref: 'unplaced', type: 'software.feature', title: 'No place yet' },
    { op: 'create', ref: 'sub', type: 'software.feature', title: 'Sub' },
    { op: 'create', ref: 't1', type: 'task', title: 'T1', status: 'done' },
    { op: 'create', ref: 't2', type: 'task', title: 'T2', status: 'doing' },
    { op: 'create', ref: 't3', type: 'software.bug', title: 'T3' },
    { op: 'create', ref: 'loose', type: 'task', title: 'Loose' },
    { op: 'create', ref: 'note', type: 'note', title: 'Not work' },
    ...['late', 'early', 'unplaced', 'loose'].map((from): Op => ({ op: 'link', type: 'part_of', from, to: 'p' })),
    { op: 'link', type: 'part_of', from: 'sub', to: 'early' },
    { op: 'link', type: 'part_of', from: 't1', to: 'early' },
    { op: 'link', type: 'part_of', from: 'note', to: 'early' },
    { op: 'link', type: 'part_of', from: 't2', to: 'sub' },
    { op: 'link', type: 'part_of', from: 't3', to: 'late' },
  ]);

  const roots = (await VIEWS.tree.run(l, {})) as any;
  assert.deepEqual(roots.roots.map((r: any) => [r.title, r.branches]), [['Proj', 3], ['Other', 0]], 'without a root, the projects to choose from');

  const tree = (await VIEWS.tree.run(l, { root: made.p })) as any;
  assert.deepEqual(tree.branches.map((b: any) => b.title), ['Early', 'Late', 'No place yet'], 'placed features in order, the rest after');
  const early = tree.branches[0];
  assert.deepEqual(early.progress, { done: 1, total: 2 }, 'a feature counts the work under its sub-features; a note is not work');
  assert.deepEqual([early.status, early.active, early.branches[0].title], ['building', true, 'Sub']);
  assert.deepEqual(tree.progress, { done: 1, total: 4 }, 'the project counts all of it, placed or not');
  assert.deepEqual(tree.unplaced.map((w: any) => w.title), ['Loose']);
  assert.deepEqual(tree.depends, [], 'no dependencies yet');
  assert.deepEqual(tree.by_status, { building: 1, planned: 3 });
  assert.deepEqual(tree.now.map((n: any) => [n.title, n.path.join(' > ')]), [['Early', ''], ['T2', 'Early > Sub']], 'what is being built, and under what');

  const session = await sessionStart(l, agent, { task: made.t3, title: 'Fixing T3' });
  await make(l, [
    { op: 'link', type: 'depends_on', from: made.late, to: made.early },
    { op: 'link', type: 'depends_on', from: made.t1, to: made.other },
  ]);
  const withSession = (await VIEWS.tree.run(l, { root: made.p })) as any;
  assert.deepEqual(withSession.depends, [{ from: made.late, to: made.early }], 'only dependencies between things in the tree');
  const late = withSession.branches[1];
  assert.deepEqual([late.active, late.work[0].sessions[0].id], [true, session.run], 'an open session marks its task and the feature above it');

  await make(l, [{ op: 'link', type: 'part_of', from: made.loose, to: made.late }]);
  const placed = (await VIEWS.tree.run(l, { root: made.p })) as any;
  assert.deepEqual([placed.unplaced.length, placed.branches[1].work.map((w: any) => w.title).sort()], [0, ['Loose', 'T3']], 'work given a feature sits under it, though still part of the project');
});

test('a project\'s unsettled questions are what needs settling in it, what holds up the most first', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Proj' },
    { op: 'create', ref: 'other', type: 'project', title: 'Other' },
    { op: 'create', ref: 'f', type: 'software.feature', title: 'Feature' },
    { op: 'create', ref: 't', type: 'task', title: 'Task' },
    { op: 'create', ref: 'big', type: 'decision', title: 'Big', props: { options: ['A', 'B'] } },
    { op: 'create', ref: 'small', type: 'decision', title: 'Small' },
    { op: 'create', ref: 'old', type: 'decision', title: 'Old', status: 'decided', props: { outcome: 'Yes', rationale: 'Because' } },
    { op: 'create', ref: 'hyp', type: 'hypothesis', title: 'Hyp' },
    { op: 'create', ref: 'exp', type: 'experiment', title: 'Try it' },
    { op: 'create', ref: 'else', type: 'decision', title: 'Elsewhere' },
    { op: 'link', type: 'part_of', from: 'f', to: 'p' },
    { op: 'link', type: 'part_of', from: 't', to: 'f' },
    { op: 'link', type: 'part_of', from: 'small', to: 'p' },
    { op: 'link', type: 'part_of', from: 'old', to: 'p' },
    { op: 'link', type: 'part_of', from: 'else', to: 'other' },
    // A question is a project's when it is part of it: one its work only depends on is named as what blocks that work.
    { op: 'link', type: 'part_of', from: 'big', to: 'p' },
    { op: 'link', type: 'part_of', from: 'hyp', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'f', to: 'big' },
    { op: 'link', type: 'depends_on', from: 't', to: 'f' },
    { op: 'link', type: 'assumes', from: 't', to: 'hyp' },
    { op: 'link', type: 'tests', from: 'exp', to: 'hyp' },
  ]);

  const unsettled = async (within: string) => (await attend(l, { within, reasons: ['unsettled', 'holding_up'] })).items.filter((x: any) => x.reasons.some((r: any) => r.why === 'unsettled'));
  const q = await unsettled(made.p);
  assert.deepEqual([q[0].title, ...q.slice(1).map((x: any) => x.title).sort()], ['Big', 'Hyp', 'Small'], 'what holds up the most comes first; another project\'s question is left out, and a settled one');
  assert.deepEqual(q[0].reasons, [{ why: 'holding_up', count: 2 }, { why: 'unsettled', by: 'word' }], 'found through what depends on it, counting what waits behind that');
  assert.deepEqual(q.find((x: any) => x.title === 'Hyp').reasons, [{ why: 'unsettled', by: 'evidence' }]);
  assert.deepEqual((await unsettled(made.other)).map((x: any) => x.title), ['Elsewhere']);

  await make(l, [{ op: 'update', id: made.big, status: 'decided', props: { outcome: 'A', decided_on: '2026-10-07' } }]);
  assert.deepEqual((await unsettled(made.p)).map((x: any) => x.title).sort(), ['Hyp', 'Small']);
});

test('a question in a project inside another is both projects\', and sits in the outer one at the top', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Parent' },
    { op: 'create', ref: 'sub', type: 'project', title: 'Area' },
    { op: 'create', ref: 'd', type: 'decision', title: 'Which way?' },
    { op: 'link', type: 'part_of', from: 'sub', to: 'p' },
    { op: 'link', type: 'part_of', from: 'd', to: 'sub' },
  ]);
  const within = async (id: string) => (await attend(l, { within: id, reasons: ['unsettled'] })).items.map((x: any) => [x.title, x.top.title]);
  assert.deepEqual(await within(made.p), [['Which way?', 'Parent']]);
  assert.deepEqual(await within(made.sub), [['Which way?', 'Parent']], 'its own page still answers');
});

test('an agent may settle its own work unreviewed, but only proposes the answer to a question', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'd', type: 'decision', title: 'Where do backups go?' },
    { op: 'create', ref: 'h', type: 'hypothesis', title: 'Hooks run in the desktop app' },
    { op: 'create', ref: 't', type: 'task', title: 'Wire the upload' },
  ]);
  // As in dev mode: nothing an agent does is reviewed.
  const free = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', link: 'auto' });
  const decided = l.registry.type('decision')!.statuses.closed[0];
  const settled = l.registry.type('hypothesis')!.statuses.closed[0];

  assert.equal((await free.change(agent, { reason: 'did it', ops: [{ op: 'update', id: made.t, status: 'done' }] })).status, 'applied', 'its own task');
  assert.equal((await free.change(agent, { reason: 'a note', ops: [{ op: 'update', id: made.d, body: 'Supabase is set up.' }] })).status, 'applied', 'a note on a question');
  const answer = await free.change(agent, { reason: 'Backups have gone to Supabase Storage since the deployment', ops: [{ op: 'update', id: made.d, status: decided, props: { outcome: 'Supabase Storage' } }] });
  assert.equal(answer.status, 'proposed', 'the answer to a decision waits for the human');
  assert.equal((await free.change(agent, { reason: 'seen twice', ops: [{ op: 'update', id: made.h, status: settled }] })).status, 'proposed', 'and so does a hypothesis');
  assert.equal((await l.entity(made.d))!.status, 'open');

  await l.decide(human, { proposal: (answer as { proposal: string }).proposal, approve: true });
  const d = (await l.entity(made.d))!;
  assert.deepEqual([d.status, d.props.outcome], [decided, 'Supabase Storage'], 'one yes from the human and it is decided');
  assert.equal((await free.change(human, { reason: 'mine to settle', ops: [{ op: 'update', id: made.h, status: settled }] })).status, 'applied');
});

test('a held change that asks only for what is already so leaves the queue as superseded', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'd', type: 'decision', title: 'Where do backups go?' },
    { op: 'create', ref: 't', type: 'task', title: 'Wire the upload' },
    { op: 'create', ref: 'u', type: 'task', title: 'Prune old copies' },
  ]);
  const hold = async (ops: any[]) => ((await l.change(agent, { reason: 'held', ops })) as { proposal: string }).proposal;
  const answer = await hold([{ op: 'update', id: made.d, status: 'decided', props: { outcome: 'Supabase' } }]);
  const both = await hold([{ op: 'update', id: made.t, status: 'done' }, { op: 'update', id: made.u, status: 'done' }]);
  const more = await hold([{ op: 'update', id: made.t, status: 'done', body: 'With a note that is not there yet.' }]);
  const other = await hold([{ op: 'update', id: made.d, status: 'reversed' }]);

  // The human settles the decision and one of the two tasks themselves.
  const settled = await l.change(human, { reason: 'mine', ops: [{ op: 'update', id: made.d, status: 'decided', props: { outcome: 'Supabase Storage' } }, { op: 'update', id: made.t, status: 'done' }] });
  const pending = async () => (await l.proposals()).map((p) => p.id);
  assert.deepEqual(await pending(), [both, more, other], 'the answer already given is gone; what asks for more, or for something else, stays');
  const [gone] = await l.proposals({ status: 'superseded' });
  assert.deepEqual([gone.id, gone.note, gone.decided_by], [answer, `Already so since ${(settled as { changeset: string }).changeset}`, 'agent:pelago']);
  const said = (await l.events({ limit: 20 })).find((e: any) => e.action === 'proposal.supersede') as any;
  assert.deepEqual([said.detail.proposal, said.detail.by], [answer, (settled as { changeset: string }).changeset], 'and the log says what overtook it');

  await l.change(human, { reason: 'mine', ops: [{ op: 'update', id: made.u, status: 'done' }] });
  assert.deepEqual(await pending(), [more, other], 'once every part of it is so');
  await assert.rejects(l.decide(human, { proposal: answer, approve: true }), /already superseded/);
});

test('a backup holds every row, and restores into an empty database that then carries on', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'create', ref: 'p', type: 'project', title: 'Proj', owner: 'me' },
    { op: 'create', ref: 't', type: 'task', title: 'Task', props: { due: '2026-11-01' } },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
  ]);
  await l.change(agent, { reason: 'waiting', ops: [{ op: 'create', type: 'note', title: 'Proposed' }] });

  const taken = await dump(l.db, { id: 'default', name: 'Default' }, { id: 'local', types: [] });
  const copy = new Archipelago(await openDb(), l.registry);
  const counts = await restore(copy.db, JSON.parse(JSON.stringify(taken)));
  assert.deepEqual([counts.entity, counts.relation, counts.proposal], [3, 1, 1]);
  assert.equal(counts.event, taken.tables.event.length);

  const task = (await copy.get(made.t)) as any;
  assert.deepEqual([task.entity.title, task.entity.props.due, task.outgoing[0].title], ['Task', '2026-11-01', 'Proj']);
  assert.equal((await copy.proposals()).length, 1, 'what was waiting for review still is');
  const before = Math.max(...taken.tables.event.map((e) => e.seq as number));
  await make(copy, [{ op: 'create', type: 'note', title: 'After the restore' }]);
  const { rows } = await copy.db.query<{ seq: number }>(`select max(seq)::int as seq from event`);
  assert.ok(rows[0].seq > before, 'new events are numbered after the restored ones');
  await assert.rejects(restore(copy.db, taken), /not empty/);
});

test('a backup merges into a map that has moved on: nothing is lost, the later edit wins, and twice is the same as once', async () => {
  const a = await fresh();
  const made = await make(a, [
    { op: 'create', ref: 'p', type: 'project', title: 'Proj' },
    { op: 'create', ref: 't', type: 'task', title: 'Task' },
    { op: 'create', ref: 'u', type: 'task', title: 'Other task' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
  ]);
  await a.change(agent, { reason: 'waiting', ops: [{ op: 'create', type: 'note', title: 'Proposed' }] });
  const snapshot = async (l: Archipelago) => JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' })));
  // b starts as a copy of a, then each goes its own way.
  const b = new Archipelago(await openDb(), a.registry);
  await restore(b.db, await snapshot(a));
  const partOf = ((await a.get(made.t)) as any).outgoing[0].relation;

  await make(b, [{ op: 'update', id: made.p, title: 'Proj, renamed in b' }, { op: 'create', type: 'note', title: 'Only in b' }]);
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
  await make((await workspaces.get('acme')).pelago, [{ op: 'create', type: 'task', title: 'Theirs' }]);
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
    { op: 'create', type: 'note', title: 'Roadmap for the garden app' },
    { op: 'create', type: 'note', title: 'Hosting', body: 'Where the deployment runs.' },
    { op: 'create', type: 'note', title: 'Unrelated', body: 'Mentions hosting once, in passing, among many other words about something else entirely.' },
    { op: 'create', type: 'note', title: 'Nothing to do with it' },
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

test('an event is a gate: what holds it by stream, what can follow, and what is not yet sorted', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'create', ref: 'app', type: 'project', title: 'App' },
    { op: 'create', ref: 'business', type: 'project', title: 'Business' },
    { op: 'create', ref: 'addin', type: 'software.feature', title: 'Add-in' },
    { op: 'create', ref: 'installer', type: 'software.feature', title: 'Installer' },
    { op: 'create', ref: 'docs', type: 'software.feature', title: 'Docs' },
    { op: 'create', ref: 'sign', type: 'task', title: 'Sign the package' },
    { op: 'create', ref: 'cert', type: 'decision', title: 'Which certificate?', owner: 'me' },
    { op: 'create', ref: 'clean', type: 'task', title: 'Uninstall leaves it clean', status: 'done' },
    { op: 'create', ref: 'hover', type: 'task', title: 'Hover cards' },
    { op: 'create', ref: 'extras', type: 'task', title: 'Capture extras' },
    { op: 'create', ref: 'guide', type: 'task', title: 'Write the guide' },
    { op: 'create', ref: 'pricing', type: 'decision', title: 'What does it cost?', owner: 'me' },
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
    { op: 'create', ref: 'app', type: 'project', title: 'App' },
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
  })) as { recorded: number; passed: number; failed: number; unknown: string[] };
  assert.deepEqual({ recorded: first.recorded, passed: first.passed, failed: first.failed, unknown: first.unknown }, { recorded: 2, passed: 1, failed: 1, unknown: ['Sun.Nobody'] });
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

test('a picture is kept for a result only when sent, travels in a backup, and goes when the test is run again', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'app', type: 'project', title: 'App' },
    { op: 'create', ref: 'sun', type: 'software.proof', title: 'How do we know the sun is correct?' },
    { op: 'create', ref: 'noaa', type: 'software.test', title: 'Sun position against NOAA', status: 'current', props: { entrypoint: 'Sun.MatchesNoaa' } },
    { op: 'link', type: 'part_of', from: 'sun', to: 'app' },
    { op: 'link', type: 'software.answers', from: 'noaa', to: 'sun' },
  ]);
  type Found = { id: string; picture: string | null; stored: boolean };
  const found = async () => ((await callTool(l, human, 'view', { name: 'proof', params: { of: made.app } })) as { proofs: { tests: { result: Found | null }[] }[] }).proofs[0].tests[0].result!;

  // A report says where the picture is in the repository; the file stays there.
  await callTool(l, human, 'test_report', { build: '1.0.0', results: [{ test: 'Sun.MatchesNoaa', passed: true, picture: '.proof/1.0.0/Sun.MatchesNoaa.png' }] });
  const first = await found();
  assert.deepEqual([first.picture, first.stored], ['.proof/1.0.0/Sun.MatchesNoaa.png', false]);
  assert.equal(await callTool(l, human, 'picture', { result: first.id }), null);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const put = (data: Buffer, content_type = 'image/png', result = first.id) => callTool(l, human, 'picture_put', { result, data: data.toString('base64'), content_type });
  await put(png);
  assert.equal((await found()).stored, true);
  const back = (await callTool(l, human, 'picture', { result: first.id })) as { content_type: string; size: number; data: string };
  assert.deepEqual([back.content_type, back.size, Buffer.from(back.data, 'base64').equals(png)], ['image/png', png.length, true]);

  // Sent again it replaces what was kept: one picture for one result.
  await put(Buffer.concat([png, png]));
  assert.equal((await l.db.query<{ n: number; size: number }>(`select count(*)::int as n, max(size)::int as size from picture`)).rows[0].size, png.length * 2);
  await assert.rejects(put(Buffer.alloc(1_000_001)), /the most kept is/);
  await assert.rejects(callTool(l, human, 'picture_put', { result: first.id, data: png.toString('base64'), content_type: 'image/svg+xml' }), /Invalid input|must be one of/);
  await assert.rejects(put(png, 'image/png', made.noaa), /not a test result/);

  // A backup carries the picture, byte for byte.
  const copy = new Archipelago(await openDb(), l.registry);
  const counts = await restore(copy.db, JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' }))));
  assert.equal(counts.picture, 1);
  const restored = (await callTool(copy, human, 'picture', { result: first.id })) as { data: string };
  assert.ok(Buffer.from(restored.data, 'base64').equals(Buffer.concat([png, png])));

  // Run again, on this build or a later one, the test loses the picture kept for it: it no longer shows what the test found.
  const again = (await callTool(l, human, 'test_report', { build: '1.0.1', results: [{ test: made.noaa, passed: true }] })) as { pictures_removed: number };
  assert.equal(again.pictures_removed, 1);
  assert.equal((await l.db.query<{ n: number }>(`select count(*)::int as n from picture`)).rows[0].n, 0);
});

test('a release is not clear until what it ships is proven on its own build, and a changelog is only what is built', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'app', type: 'project', title: 'App' },
    { op: 'create', ref: 'addin', type: 'software.feature', title: 'Add-in', status: 'built' },
    { op: 'create', ref: 'panel', type: 'software.feature', title: 'Panel', status: 'built' },
    { op: 'create', ref: 'old', type: 'software.feature', title: 'Presets', status: 'shipped' },
    { op: 'create', ref: 'later', type: 'software.feature', title: 'Sheets', status: 'planned' },
    { op: 'create', ref: 'proofs', type: 'software.feature', title: 'Public proof', status: 'built' },
    { op: 'create', ref: 'sun', type: 'software.proof', title: 'How do we know the sun is correct?' },
    { op: 'create', ref: 'noaa', type: 'software.test', title: 'Sun position against NOAA', status: 'current', props: { entrypoint: 'Sun.MatchesNoaa' } },
    { op: 'create', ref: 'release', type: 'software.release', title: 'Version 1.0', props: { version: '1.0.0' } },
    { op: 'link', type: 'part_of', from: 'addin', to: 'app' },
    { op: 'link', type: 'part_of', from: 'panel', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'old', to: 'app' },
    { op: 'link', type: 'part_of', from: 'later', to: 'app' },
    { op: 'link', type: 'part_of', from: 'proofs', to: 'app' },
    { op: 'link', type: 'part_of', from: 'sun', to: 'proofs' },
    { op: 'link', type: 'software.answers', from: 'noaa', to: 'sun' },
    { op: 'link', type: 'software.ships', from: 'release', to: 'addin' },
    // The questions are asked of a feature the release does not ship: it is held by it, and so they are the release's too.
    { op: 'link', type: 'depends_on', from: 'release', to: 'proofs' },
  ]);
  type Gate = { clear: boolean; proof: { build: string | null; named: boolean; counts: { questions: number; answered: number }; questions: { id: string; answered: boolean }[] } | null };
  const gate = async () => (await VIEWS.gate.run(l, { event: made.release })) as Gate;

  // Passing on an earlier build does not answer for the build that is released.
  await callTool(l, human, 'test_report', { build: '0.9.0', results: [{ test: made.noaa, passed: true }] });
  const before = await gate();
  assert.deepEqual([before.proof!.build, before.proof!.named, before.proof!.counts.answered, before.clear], ['1.0.0', true, 0, false]);
  await callTool(l, human, 'test_report', { build: '1.0.0', results: [{ test: made.noaa, passed: true }] });
  const after = await gate();
  assert.deepEqual([after.proof!.counts.answered, after.proof!.questions[0].answered, after.clear], [1, true, true]);

  // A changelog is what is built or shipped, with the release each went out in; what is only planned is not in it.
  const log = (await callTool(l, human, 'view', { name: 'changelog', params: { of: made.app } })) as { counts: Record<string, number>; features: { id: string; status: string; release: { version: string | null } | null }[] };
  assert.deepEqual(log.counts, { built: 3, shipped: 1 });
  assert.deepEqual(log.features.map((f) => f.id).sort(), [made.addin, made.old, made.panel, made.proofs].sort());
  assert.equal(log.features.at(-1)!.id, made.old, 'what is built and not yet released comes first');
  assert.equal(log.features.find((f) => f.id === made.panel)!.release!.version, '1.0.0', 'a part goes out with what it is part of');
  assert.equal(log.features.find((f) => f.id === made.old)!.release, null);
});

test('costs: dollars where a run says, tokens where it does not, and each regular payment by its share', async () => {
  const l = await fresh();
  const longAgo = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const made = await make(l, [
    { op: 'create', ref: 'repo', type: 'software.repo', title: 'Repo' },
    { op: 'create', ref: 'host', type: 'money.cost', title: 'Hosting', props: { amount: 25, since: longAgo, vendor: 'Render' } },
    { op: 'create', ref: 'domain', type: 'money.cost', title: 'Domain', props: { amount: 120, every: 'year', since: longAgo } },
    { op: 'create', ref: 'unknown', type: 'money.cost', title: 'Subscription' },
    { op: 'create', ref: 'euro', type: 'money.cost', title: 'Licence', props: { amount: 10, currency: 'EUR', since: longAgo } },
    { op: 'create', ref: 'ended', type: 'money.cost', title: 'Old host', status: 'ended', props: { amount: 50, since: longAgo, until: longAgo } },
  ]);
  await callTool(l, human, 'run_report', { repo: made.repo, title: 'Read a push', tokens: 40_000, cost_usd: 0.31, surface: 'server', link: 'https://example.com/1' });
  await callTool(l, human, 'run_report', { repo: made.repo, title: 'Read another', tokens: 10_000, cost_usd: 0.09, surface: 'server', link: 'https://example.com/2' });
  await callTool(l, human, 'run_report', { repo: made.repo, title: 'A session', tokens: 900_000, surface: 'claude-code', link: 'https://example.com/3' });

  type Costs = {
    total_usd: number;
    per_month: number;
    agents: { cost_usd: number; tokens: number; unpriced_tokens: number; by: { surface: string; runs: number; cost_usd: number }[] };
    recurring: { cost_usd: number; per_month: number; items: { id: string; per_month: number | null; share: number | null }[]; unpriced: { id: string }[]; other_currencies: { id: string }[] };
  };
  const c = (await callTool(l, human, 'view', { name: 'costs', params: { days: 30 } })) as Costs;
  assert.deepEqual([c.agents.cost_usd, c.agents.tokens, c.agents.unpriced_tokens], [0.4, 950_000, 900_000]);
  assert.deepEqual(c.agents.by.map((s) => [s.surface, s.runs, s.cost_usd]), [['server', 2, 0.4], ['claude-code', 1, 0]]);
  // A month's payment, and a twelfth of a year's, over thirty days of a month of 30.44.
  const share = (monthly: number) => Math.round(((monthly * 30) / 30.4375) * 100) / 100;
  assert.equal(c.recurring.items.find((i) => i.id === made.host)!.share, share(25));
  assert.deepEqual([c.recurring.items.find((i) => i.id === made.domain)!.per_month, c.recurring.per_month], [10, 35]);
  assert.equal(c.recurring.cost_usd, Math.round((share(25) + share(10)) * 100) / 100);
  assert.deepEqual(c.recurring.unpriced.map((i) => i.id), [made.unknown], 'a payment nobody has priced is named, not guessed');
  assert.deepEqual(c.recurring.other_currencies.map((i) => i.id), [made.euro], 'another currency is listed, not added to the dollars');
  assert.ok(!c.recurring.items.some((i) => i.id === made.ended), 'what ended before the period is not in it');
  assert.equal(c.total_usd, Math.round((0.4 + c.recurring.cost_usd) * 100) / 100);
  assert.equal(c.per_month, Math.round((35 + (0.4 * 30.4375) / 30) * 100) / 100);
});

test('public: only a human makes it so, only some kinds can be, and anyone then sees little of it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'app', type: 'project', title: 'App', body: 'Internal plan: the secret margin' },
    { op: 'create', ref: 'between', type: 'software.feature', title: 'Proof work', body: 'Not for anyone' },
    { op: 'create', ref: 'sun', type: 'software.proof', title: 'How do we know the sun is correct?', body: 'An internal note' },
    { op: 'create', ref: 'areas', type: 'software.proof', title: 'How do we know the areas are correct?' },
    { op: 'create', ref: 'noaa', type: 'software.test', title: 'Sun position against NOAA', status: 'current', props: { entrypoint: 'Sun.MatchesNoaa', tolerance: 'within 0.01 degrees' } },
    { op: 'create', ref: 'square', type: 'software.test', title: 'Area of a square', status: 'current', props: { entrypoint: 'Area.Square' } },
    { op: 'create', ref: 'panel', type: 'software.feature', title: 'Panel', status: 'built' },
    { op: 'create', ref: 'hidden', type: 'software.feature', title: 'Unannounced', status: 'built' },
    { op: 'create', ref: 'choice', type: 'decision', title: 'What does it cost?' },
    { op: 'link', type: 'part_of', from: 'between', to: 'app' },
    { op: 'link', type: 'part_of', from: 'sun', to: 'between' },
    { op: 'link', type: 'part_of', from: 'areas', to: 'between' },
    { op: 'link', type: 'part_of', from: 'panel', to: 'app' },
    { op: 'link', type: 'part_of', from: 'hidden', to: 'app' },
    { op: 'link', type: 'part_of', from: 'choice', to: 'app' },
    { op: 'link', type: 'software.answers', from: 'noaa', to: 'sun' },
    { op: 'link', type: 'software.answers', from: 'square', to: 'areas' },
  ]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
  const report = (await callTool(l, human, 'test_report', {
    build: '1.0.0',
    results: [
      { test: 'Sun.MatchesNoaa', passed: true, value: '0.004 degrees', picture: '.proof/1.0.0/Sun.MatchesNoaa.png' },
      { test: 'Area.Square', passed: true, picture: '.proof/1.0.0/Area.Square.png' },
    ],
  })) as { send_pictures: unknown[] };
  assert.deepEqual(report.send_pictures, [], 'nothing is public yet, so no picture is asked for');
  type View = { proofs: { id: string; public: boolean; tests: { result: { id: string } }[] }[]; to_send: { result: string; picture: string }[] };
  const view = async () => (await callTool(l, human, 'view', { name: 'proof', params: { of: made.app } })) as View;
  const results = Object.fromEntries((await view()).proofs.map((p) => [p.id, p.tests[0].result.id]));
  for (const id of Object.values(results)) await callTool(l, human, 'picture_put', { result: id, data: png.toString('base64'), content_type: 'image/png' });

  // Nothing is public until someone says so.
  assert.equal(await publicPage(l, made.app), null);
  assert.equal(await publicPicture(l, results[made.sun]), null);

  // An agent cannot say so, even where its other changes are applied as made: it waits for the human.
  const loose = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', link: 'auto' });
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.panel, title: 'The panel' }] })).status, 'applied');
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.app, visibility: 'public' }] })).status, 'proposed');
  assert.equal(await publicPage(l, made.app), null);
  // And not everything can be: a decision is never anyone's business but the workspace's.
  await assert.rejects(l.change(human, { reason: 'x', ops: [{ op: 'update', id: made.choice, visibility: 'public' }] }), /cannot be public/);

  await make(l, [
    { op: 'update', id: made.app, visibility: 'public' },
    { op: 'update', id: made.sun, visibility: 'public' },
    { op: 'update', id: made.panel, visibility: 'public' },
  ]);
  const page = (await publicPage(l, made.app))!;
  assert.equal(page.title, 'App');
  // A public question brings its tests and results, though the feature it sits in is not public; the other question stays out.
  assert.deepEqual(page.questions.map((q) => q.id), [made.sun]);
  assert.deepEqual([page.questions[0].answered, page.questions[0].tests[0].title, page.questions[0].tests[0].result!.value, page.questions[0].tests[0].result!.picture], [true, 'Sun position against NOAA', '0.004 degrees', results[made.sun]]);
  assert.deepEqual(page.changelog.map((f) => f.title), ['The panel']);
  const said = JSON.stringify(page);
  for (const hiddenText of ['secret margin', 'internal note', 'Not for anyone', 'Unannounced', 'areas are correct', 'What does it cost', 'Area of a square']) assert.ok(!said.includes(hiddenText), `"${hiddenText}" is not given away`);
  assert.ok((await publicPicture(l, results[made.sun]))!.bytes.equals(png));
  assert.equal(await publicPicture(l, results[made.areas]), null, 'a picture is as public as its result, and no more');

  // The database itself holds the line, whatever is asked of it.
  const anyoneDb = l.forAnyone().db;
  const seen = (await anyoneDb.query<{ title: string }>(`select title from entity order by title`)).rows.map((r) => r.title);
  assert.deepEqual(seen, ['1.0.0: Sun position against NOAA', 'App', 'How do we know the sun is correct?', 'Sun position against NOAA', 'The panel']);
  await assert.rejects(anyoneDb.query(`select body from entity`), /permission denied/);
  // Of an item's fields, only what the page shows: not where a result's picture lies in its repository.
  await assert.rejects(anyoneDb.query(`select props from entity`), /permission denied/);
  const fields = async (id: string) => (await anyoneDb.query<{ props: Record<string, unknown> | null }>(`select pelago_public_props($1) as props`, [id])).rows[0].props;
  assert.deepEqual(await fields(results[made.sun]), { build: '1.0.0', passed: true, value: '0.004 degrees' });
  assert.equal(await fields(results[made.areas]), null, 'and of what is not public, none');
  await assert.rejects(anyoneDb.query(`select * from event`), /permission denied/);
  await assert.rejects(anyoneDb.query(`select * from setting`), /permission denied/);
  await assert.rejects(anyoneDb.query(`update entity set title = 'x'`), /permission denied/);
  assert.equal((await anyoneDb.query<{ n: number }>(`select count(*)::int as n from picture`)).rows[0].n, 1);

  // Once a question is public, a run says which pictures to send, and the view lists what is still owed.
  const next = (await callTool(l, human, 'test_report', { build: '1.0.1', results: [{ test: 'Sun.MatchesNoaa', passed: true, picture: '.proof/1.0.1/Sun.MatchesNoaa.png' }] })) as { send_pictures: { picture: string }[]; pictures_removed: number };
  assert.deepEqual([next.pictures_removed, next.send_pictures.map((p) => p.picture)], [1, ['.proof/1.0.1/Sun.MatchesNoaa.png']]);
  assert.deepEqual((await view()).to_send.map((p) => p.picture), ['.proof/1.0.1/Sun.MatchesNoaa.png']);

  // Taken back, it is gone from the page at once.
  await make(l, [{ op: 'update', id: made.sun, visibility: 'private' }]);
  assert.deepEqual((await publicPage(l, made.app))!.questions, []);
});

test('a member sees their own tokens and the few settings every request needs; the rest is an admin’s, by the database', async () => {
  const { createToken, listTokens } = await import('../src/auth.ts');
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'ann', type: 'person', title: 'Ann' },
    { op: 'create', ref: 'bo', type: 'person', title: 'Bo' },
  ]);
  await createToken(l.db, 'default', { kind: 'human', name: 'ann', entity: made.ann, admin: true });
  await createToken(l.db, 'default', { kind: 'human', name: 'bo', entity: made.bo });
  const set = (key: string, value: unknown) => l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
  await set('me', made.ann);
  await set('default_visibility', 'shared');
  await set('accepts_from', ['elsewhere']);
  await l.setSecret('github_secret', 'latgh_notforbo');

  const bo = l.as(made.bo);
  const ann = l.as(made.ann, true);
  // Tokens: a member's own, and one they make for an agent of theirs; not another's, to read, revoke or make.
  assert.deepEqual((await listTokens(bo.db)).map((t) => t.name), ['bo']);
  assert.deepEqual((await listTokens(ann.db)).map((t) => t.name).sort(), ['ann', 'bo']);
  await createToken(bo.db, 'default', { kind: 'agent', name: 'bo’s agent', entity: made.bo });
  await assert.rejects(createToken(bo.db, 'default', { kind: 'agent', name: 'as ann', entity: made.ann }), /row-level security/);
  assert.equal((await bo.db.query(`update token set revoked_at = now() where name = 'ann' returning id`)).rows.length, 0);

  // Settings: who the owner is and how the workspace is set, and nothing else. A secret is not there to be read, sealed or not.
  assert.equal(await bo.setting('me'), made.ann);
  assert.equal(await bo.defaultVisibility(), 'shared');
  assert.deepEqual((await bo.db.query<{ key: string }>(`select key from setting order by key`)).rows.map((r) => r.key), ['default_visibility', 'me']);
  assert.equal(await bo.secret('github_secret'), undefined);
  assert.equal(await ann.secret('github_secret'), 'latgh_notforbo');
  assert.deepEqual(await ann.setting('accepts_from'), ['elsewhere']);
  // Nor is a setting a member's to change, but for the place a connection's log has been read up to.
  await assert.rejects(bo.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"')`), /row-level security/);
  assert.equal((await bo.db.query(`update setting set value = '"private"' where key = 'default_visibility' returning key`)).rows.length, 0);
  await bo.db.query(`insert into setting (key, value) values ('audit_cursor:e_conn0001', '"2026-10-13"')`);
  await ann.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  assert.equal(await bo.agentChanges(), 'apply');
});

test('a document brings items in by id, and a link shows it and them to anyone holding it, and nothing more', async () => {
  const { sharedDocument, sectionIds } = await import('../src/documents.ts');
  const l = await fresh();
  const people = await make(l, [
    { op: 'create', ref: 'ann', type: 'person', title: 'Ann' },
    { op: 'create', ref: 'bo', type: 'person', title: 'Bo' },
  ]);
  const ann = l.as(people.ann);
  const bo = l.as(people.bo);
  const annActor: Actor = { kind: 'human', name: 'ann', person: people.ann };
  const boActor: Actor = { kind: 'human', name: 'bo', person: people.bo };
  const theirs = async (who: Archipelago, actor: Actor, ops: Op[]) => ((await who.change(actor, { ops, reason: 'test' })) as { created: Record<string, string> }).created;
  const hers = await theirs(ann, annActor, [
    { op: 'create', ref: 'mine', type: 'note', title: 'IRAP', body: 'Call the advisor first.', visibility: 'private' },
    { op: 'create', ref: 'all', type: 'note', title: 'SR&ED', body: 'Claimed after the work.', visibility: 'shared' },
  ]);
  const his = await theirs(bo, boActor, [{ op: 'create', ref: 'n', type: 'note', title: 'Bo’s secret plan', body: 'Not for Ann’s readers.', visibility: 'private' }]);
  const body = `# Funding\n\nTwo programs, and a third (${his.n}) the reader does not see.\n\n${hers.mine}\n\nBetween them, ${hers.mine} comes first.\n${hers.all}\n${his.n}\ne_nothing1\n`;
  const { doc } = await theirs(ann, annActor, [{ op: 'create', ref: 'doc', type: 'document', title: 'Funding for Northwind', body, visibility: 'private', props: { for: 'Sam' } }]);
  assert.deepEqual(sectionIds(body), [hers.mine, hers.all, his.n, 'e_nothing1']);

  // Its author reads it whole; what she may not see is said as missing, in its place.
  const read = (await callTool(ann, annActor, 'document', { id: doc })) as { for: string; parts: Record<string, any>[] };
  assert.equal(read.for, 'Sam');
  assert.deepEqual(
    read.parts.map((p) => p.section?.title ?? p.missing ?? p.text.split('\n')[0]),
    ['# Funding', 'IRAP', 'Between them, ' + hers.mine + ' comes first.', 'SR&ED', his.n, 'e_nothing1'],
  );
  // An agent may read it, but only a person makes a link, and only to what they can see.
  await assert.rejects(callTool(ann, { kind: 'agent', name: 'a', person: people.ann }, 'share_create', { id: doc }), /humans only/);
  await assert.rejects(callTool(bo, boActor, 'share_create', { id: doc }), /not a document/);
  await assert.rejects(callTool(ann, annActor, 'share_create', { id: hers.all }), /not a document/);

  const made = (await callTool(ann, annActor, 'share_create', { id: doc })) as { share: string; path: string };
  const secret = made.path.split('/').at(-1)!;
  assert.match(made.path, /^\/s\/default\/[a-f0-9]{48}$/);
  const shown = (await sharedDocument(l, secret))!;
  assert.equal(shown.title, 'Funding for Northwind');
  assert.deepEqual(
    shown.parts.map((p: Record<string, any>) => p.section?.title ?? p.text),
    ['# Funding\n\nTwo programs, and a third the reader does not see.', 'IRAP', `Between them, ${hers.mine} comes first.`, 'SR&ED'],
    'Bo’s private note is left out, and so is its id in the text; an id that is nothing is not said',
  );
  assert.equal(JSON.stringify(shown).includes('secret plan'), false);
  assert.equal(await sharedDocument(l, 'f'.repeat(48)), null, 'a link never made opens nothing');
  assert.equal(await sharedDocument(l, '../x'), null);

  // Bo cannot see her links; she can, and revoking one closes it at once. An archived document is not shown either.
  assert.deepEqual(await callTool(bo, boActor, 'share_list', { id: doc }), []);
  assert.equal(((await callTool(ann, annActor, 'share_list', { id: doc })) as unknown[]).length, 1);
  await assert.rejects(callTool(bo, boActor, 'share_revoke', { id: made.share }), /No standing link/);
  await callTool(ann, annActor, 'share_revoke', { id: made.share });
  assert.equal(await sharedDocument(l, secret), null);
  const again = (await callTool(ann, annActor, 'share_create', { id: doc })) as { path: string };
  await theirs(ann, annActor, [{ op: 'archive', id: doc }]);
  assert.equal(await sharedDocument(l, again.path.split('/').at(-1)!), null);
  // What was done is in the history.
  const actions = (await l.db.query<{ action: string }>(`select action from event where target_id = $1 and action like 'share.%' order by seq`, [doc])).rows.map((r) => r.action);
  assert.deepEqual(actions, ['share.create', 'share.revoke', 'share.create']);
});

test('what is made for a reader is marked deliverable by its type, and a document names the sections kept outside it', async () => {
  const l = await fresh();
  const marked = (await callTool(l, human, 'schema', {})) as { types: { id: string; deliverable?: boolean }[] };
  const deliverable = (id: string) => Boolean(marked.types.find((t) => t.id === id)?.deliverable);
  assert.deepEqual(['document', 'file', 'software.release', 'software.spec', 'note', 'task'].map(deliverable), [true, true, true, false, false, false]);
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Research' },
    { op: 'create', ref: 'a', type: 'note', title: 'Inside' },
    { op: 'create', ref: 'b', type: 'note', title: 'Beside' },
    { op: 'create', ref: 'd', type: 'document', title: 'Brief', body: '{a}\n{b}' },
    { op: 'link', type: 'part_of', from: 'd', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'd' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
  ]);
  const read = (await callTool(l, human, 'document', { id: made.d })) as { not_inside?: string[] };
  assert.deepEqual(read.not_inside, [made.b]);
  await make(l, [{ op: 'link', type: 'part_of', from: made.b, to: made.d }]);
  assert.equal(((await callTool(l, human, 'document', { id: made.d })) as { not_inside?: string[] }).not_inside, undefined);
});

test('a lens files items by a field, sends the fields their pack shows, and says what a link says', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Research project' },
    { op: 'create', ref: 'ops', type: 'project', title: 'Business and operations' },
    { op: 'create', ref: 'irap', type: 'funding.program', title: 'NRC IRAP', status: 'open', props: { kind: 'grant', phase: 'research', amount: 'salaries ~80%', run_by: 'NRC' } },
    { op: 'create', ref: 'sred', type: 'funding.program', title: 'SR&ED', status: 'open', props: { kind: 'tax_credit', phase: 'prove', deadline: '2027-06-30', deadline_note: 'file by' } },
    { op: 'create', ref: 'lift', type: 'funding.program', title: 'BDC LIFT', status: 'open', props: { kind: 'loan', phase: 'build' } },
    { op: 'link', type: 'part_of', from: 'ops', to: 'p' },
    { op: 'link', type: 'part_of', from: 'irap', to: 'ops' },
    { op: 'link', type: 'part_of', from: 'sred', to: 'p' },
    { op: 'link', type: 'part_of', from: 'lift', to: 'ops' },
    { op: 'link', type: 'funding.reduces', from: 'sred', to: 'irap', props: { says: 'IRAP money is subtracted first' } },
  ]);
  await assert.rejects(callTool(l, human, 'view', { name: 'lens', params: { from: made.p, lanes: 'field:nothing_like_it' } }), /no type has a field "nothing_like_it"/);
  const answer = (await callTool(l, human, 'view', { name: 'lens', params: { from: made.p, lanes: 'field:phase', over: ['funding.reduces'] } })) as {
    said: string;
    lanes: string[];
    items: { id: string; lane?: string | null; fields?: Record<string, unknown>; inside: string | null }[];
    links: { kind: string; from: string; to: string; says?: string }[];
  };
  const item = (id: string) => answer.items.find((i) => i.id === id)!;
  assert.deepEqual(answer.lanes, ['set_up', 'research', 'build', 'prove']);
  assert.match(answer.said, /filed by its phase/);
  assert.deepEqual([item(made.irap).lane, item(made.lift).lane, item(made.sred).lane, item(made.ops).lane], ['research', 'build', 'prove', null]);
  assert.deepEqual(item(made.irap).fields, { kind: 'grant', phase: 'research', amount: 'salaries ~80%' }, 'run_by is not shown');
  assert.deepEqual(item(made.sred).fields, { kind: 'tax_credit', phase: 'prove', deadline: '2027-06-30', deadline_note: 'file by' });
  assert.equal(item(made.ops).fields, undefined);
  assert.equal(item(made.irap).inside, made.ops);
  assert.deepEqual(answer.links, [{ kind: 'funding.reduces', from: made.sred, to: made.irap, n: 1, says: 'IRAP money is subtracted first' }]);
});

test('a lens asked for by its id alone starts from what it is kept about, and can keep a still', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Research project' },
    { op: 'create', ref: 'q', type: 'project', title: 'Something else' },
    { op: 'create', ref: 'irap', type: 'funding.program', title: 'NRC IRAP', status: 'open', props: { kind: 'grant', phase: 'research' } },
    { op: 'create', ref: 'other', type: 'task', title: 'Elsewhere' },
    { op: 'create', ref: 'v', type: 'lens', title: 'Funding map', props: { kinds: ['project', 'funding.program'], lanes: 'field:phase' } },
    { op: 'link', type: 'part_of', from: 'irap', to: 'p' },
    { op: 'link', type: 'part_of', from: 'other', to: 'q' },
    { op: 'link', type: 'about', from: 'v', to: 'p' },
  ]);
  const answer = (await callTool(l, human, 'view', { name: 'lens', params: { lens: made.v } })) as { view: string; items: { id: string }[] };
  assert.equal(answer.view, made.v);
  assert.deepEqual(answer.items.map((i) => i.id).sort(), [made.p, made.irap].sort());
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  assert.equal(((await callTool(l, human, 'picture_put', { result: made.v, data: png, content_type: 'image/png' })) as { size: number }).size, 8);
});

test('an item says where it sits: what it is part of, outermost first, with the views kept about each', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Research project' },
    { op: 'create', ref: 'area', type: 'project', title: 'Simulation tools' },
    { op: 'create', ref: 'prog', type: 'funding.program', title: 'Mitacs AI Advantage', status: 'upcoming' },
    { op: 'create', ref: 'map', type: 'lens', title: 'Funding map', props: { place: 1 } },
    { op: 'create', ref: 'cut', type: 'lens', title: 'Shortcut', props: { from: 'e_elsewhere' } },
    { op: 'link', type: 'part_of', from: 'area', to: 'p' },
    { op: 'link', type: 'part_of', from: 'prog', to: 'area' },
    { op: 'link', type: 'about', from: 'map', to: 'p' },
    { op: 'link', type: 'about', from: 'cut', to: 'p' },
  ]);
  const { trail } = (await callTool(l, human, 'get', { id: made.prog })) as { trail: { id: string; title: string; views: { title: string }[] }[] };
  assert.deepEqual(trail.map((t) => [t.title, t.views.map((v) => v.title)]), [['Research project', ['Funding map']], ['Simulation tools', []]], 'a shortcut is not a view of it');
  assert.deepEqual(((await callTool(l, human, 'get', { id: made.p })) as { trail: unknown[] }).trail, []);
});

test('an item knows what names it in its text or fields, documents first, and only what the asker may see', async () => {
  const l = await fresh();
  const people = await make(l, [{ op: 'create', ref: 'bo', type: 'person', title: 'Bo' }]);
  const made = await make(l, [
    { op: 'create', ref: 'n', type: 'note', title: 'FedDev section', visibility: 'shared' },
    { op: 'create', ref: 't', type: 'task', title: 'Send the document', body: 'Details in {n}.', visibility: 'shared' },
    { op: 'create', ref: 'd', type: 'document', title: 'Funding document', body: 'Intro\n{n}', visibility: 'shared' },
  ]);
  Object.assign(made, await make(l, [{ op: 'create', ref: 'q', type: 'decision', title: 'Apply to RAII?', visibility: 'shared', props: { rationale: `See ${made.n}` } }]));
  const mentions = async (who: Archipelago) => ((await callTool(who, human, 'get', { id: made.n })) as { mentioned_in: { id: string }[] }).mentioned_in.map((m) => m.id);
  const all = await mentions(l);
  assert.equal(all[0], made.d, 'the document comes first');
  assert.deepEqual([...all].sort(), [made.t, made.d, made.q].sort());
  // Bo's own private note naming it is his alone to see.
  const bo = l.as(people.bo);
  await bo.change({ kind: 'human', name: 'bo', person: people.bo }, { ops: [{ op: 'create', type: 'note', title: 'Mine', body: `About ${made.n}`, visibility: 'private' }], reason: 'test' });
  assert.equal((await mentions(bo)).length, 4);
  assert.equal((await mentions(l.as('someone else'))).length, 3);
});

test('an item knows the pictures it is drawn in, and the documents that show them', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Research project' },
    { op: 'create', ref: 'in', type: 'funding.program', title: 'Mitacs Accelerate', status: 'open', props: { kind: 'wage_subsidy', phase: 'research' } },
    { op: 'create', ref: 'out', type: 'task', title: 'Call IRAP' },
    { op: 'create', ref: 'map', type: 'lens', title: 'Funding map', props: { kinds: ['project', 'funding.program'] } },
    { op: 'create', ref: 'd', type: 'document', title: 'Funding document', body: 'Intro\n{map}' },
    { op: 'link', type: 'part_of', from: 'in', to: 'p' },
    { op: 'link', type: 'part_of', from: 'out', to: 'p' },
    { op: 'link', type: 'about', from: 'map', to: 'p' },
  ]);
  const shown = async (id: string) => ((await callTool(l, human, 'get', { id })) as { shown_in: { title: string; of: { id: string }; documents: { id: string }[] }[] }).shown_in;
  assert.deepEqual(await shown(made.in), [{ id: made.map, title: 'Funding map', of: { id: made.p, title: 'Research project' }, documents: [{ id: made.d, title: 'Funding document' }] }]);
  assert.deepEqual(await shown(made.out), [], 'a task is not in a picture of programs');
});

test('a session’s turns are kept as stretches of work: a prompt begins one, a stop ends it, a long quiet starts the next', async () => {
  const { stretch, IDLE_MS } = await import('../src/sessions.ts');
  const t = (m: number) => new Date(Date.parse('2026-10-15T12:00:00Z') + m * 60_000).toISOString();
  let s = stretch([], t(0), 'at');
  s = stretch(s, t(40), 'until');
  assert.deepEqual(s, [[t(0), t(40)]], 'a turn runs from its prompt to its stop, however long');
  s = stretch(s, t(45), 'at');
  assert.deepEqual(s, [[t(0), t(45)]], 'a prompt a moment after a turn ended carries the stretch on');
  s = stretch(s, t(45 + IDLE_MS / 60_000 + 5), 'at');
  assert.equal(s.length, 2, 'after a long quiet, a new stretch');
  assert.deepEqual(stretch(s, t(600), 'close'), s, 'a session closed hours after it went quiet stopped when it went quiet');
  const l = await fresh();
  await sessionStart(l, agent, { session_id: 'turns' });
  const { sessionHeard } = await import('../src/sessions.ts');
  await sessionHeard(l, 'turns', 'begin');
  const run = (await l.db.query<{ props: Record<string, unknown> }>(`select props from entity where props->>'session_id' = 'turns'`)).rows[0];
  assert.deepEqual([(run.props.active as unknown[]).length, run.props.busy], [1, true]);
  await sessionHeard(l, 'turns', 'until');
  const after = (await l.db.query<{ props: Record<string, unknown> }>(`select props from entity where props->>'session_id' = 'turns'`)).rows[0];
  assert.equal(after.props.busy, false);
});

