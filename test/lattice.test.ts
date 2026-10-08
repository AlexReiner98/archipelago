import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Automations } from '../src/automations.ts';
import { backupAll, dump, merge, newestBackup, readBackup, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { configureLauncher, launch } from '../src/launcher.ts';
import { Lattice, type Actor, type Op } from '../src/lattice.ts';
import { Registry } from '../src/packs.ts';
import { hookSessionEnd, hookSessionStart, sessionEnd, sessionStart, sessionUpdate } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { VIEWS } from '../src/views.ts';
import { Workspaces } from '../src/workspaces.ts';

const human: Actor = { kind: 'human', name: 'test' };
const agent: Actor = { kind: 'agent', name: 'test' };

/** A fresh in-memory map with its own copy of the packs, so tests can define types. */
async function fresh() {
  const packs = mkdtempSync(join(tmpdir(), 'lattice-packs-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  return new Lattice(await openDb(), new Registry(packs));
}

async function make(l: Lattice, ops: Op[]) {
  const result = await l.change(human, { ops, reason: 'test' });
  assert.equal(result.status, 'applied');
  return (result as { created: Record<string, string> }).created;
}

test('flavours inherit fields and statuses, and are found through the parent', async () => {
  const l = await fresh();
  const bug = l.registry.type('software.bug')!;
  assert.deepEqual(bug.lineage, ['software.bug', 'issue']);
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
  const loose = new Lattice(l.db, l.registry, { create: 'auto', merge: 'forbidden' });
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

  const blockers = (await VIEWS.blockers.run(l, {})) as any[];
  const ship = blockers.find((b) => b.entity.id === made.ship);
  assert.deepEqual(ship.blocked_by.map((b: any) => b.entity.title), ['Sign installer']);
  assert.deepEqual(ship.root_blockers.map((b: any) => b.title), ['Which certificate?']);

  const needs = (await VIEWS.needs_me.run(l, { person: made.me })) as any;
  assert.deepEqual(needs.actionable.map((t: any) => t.title), ['Write notes']);
  const waiting = (await VIEWS.waiting_on.run(l, { person: made.me })) as any;
  assert.equal(waiting.blocked_by_others.length, 2);
  const onSam = (await VIEWS.blocked_on_me.run(l, { person: made.sam })) as any[];
  assert.equal(onSam[0].holding_up.length, 2);

  // Closing the decision unblocks the next task in the chain, with nothing else to update.
  await make(l, [{ op: 'update', id: made.cert, status: 'decided', props: { outcome: 'EV cert' } }]);
  const after = (await VIEWS.needs_me.run(l, { person: made.me })) as any;
  assert.deepEqual(after.actionable.map((t: any) => t.title).sort(), ['Sign installer', 'Write notes']);
  await assert.rejects(VIEWS.needs_me.run(l, {}), /lattice init/);
});

test('a dependency cycle does not hang the views', async () => {
  const l = await fresh();
  await make(l, [
    { op: 'create', ref: 'a', type: 'task', title: 'A' },
    { op: 'create', ref: 'b', type: 'task', title: 'B' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
  ]);
  assert.equal(((await VIEWS.blockers.run(l, {})) as any[]).length, 2);
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
  const before = (await VIEWS.available_now.run(l, {})) as any;
  assert.equal(before.ready.length, 3);

  // Agents claim directly: no proposal.
  const claimed = await l.claim(agent, { resource: made.lane, holder: made.run1, for: made.live1, reason: 'Running the probe' });
  assert.equal(claimed.status, 'claimed');
  await assert.rejects(l.claim(agent, { resource: made.lane, holder: made.run2, reason: 'Me too' }), /held by "Session one"/);

  const during = (await VIEWS.available_now.run(l, {})) as any;
  assert.deepEqual(during.ready.map((t: any) => t.title).sort(), ['Capture parity probe', 'Write unit tests']);
  assert.deepEqual(during.waiting_on_resource.map((t: any) => t.title), ['Debug conduit']);
  assert.equal(during.held_resources[0].held_by_title, 'Session one');

  assert.deepEqual(await l.release(agent, { resource: made.lane, holder: made.run1, reason: 'Done' }), { released: 1 });
  assert.equal((await l.claim(agent, { resource: made.lane, holder: made.run2, reason: 'My turn' })).status, 'claimed');
});

test('work resting on a refuted hypothesis, and overdue work, show as at risk', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'h', type: 'hypothesis', title: 'Architects will pay per study' },
    { op: 'create', ref: 'p', type: 'project', title: 'Per-study pricing' },
    { op: 'create', ref: 'late', type: 'task', title: 'File return', props: { due: '2020-01-01' } },
    { op: 'create', type: 'task', title: 'Far off', props: { due: '2999-01-01' } },
    { op: 'link', type: 'assumes', from: 'p', to: 'h' },
  ]);
  let risk = (await VIEWS.at_risk.run(l, {})) as any;
  assert.equal(risk.resting_on_refuted_hypothesis.length, 0);
  assert.deepEqual(risk.due_soon_or_overdue.map((t: any) => [t.title, t.overdue]), [['File return', true]]);

  await make(l, [{ op: 'update', id: made.h, status: 'refuted' }]);
  risk = (await VIEWS.at_risk.run(l, {})) as any;
  assert.equal(risk.resting_on_refuted_hypothesis[0].title, 'Per-study pricing');
});

test('merge moves relations to the kept entity and archives the other', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 's1', type: 'person', title: 'Sam Patel', props: { email: 'sam@example.com' } },
    { op: 'create', ref: 's2', type: 'person', title: 'S. Patel', props: { role: 'Planner' } },
    { op: 'create', ref: 'co', type: 'company', title: 'Acme' },
    { op: 'create', ref: 't', type: 'task', title: 'Reply to Sam', owner: 's2' },
    { op: 'link', type: 'works_at', from: 's2', to: 'co' },
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
  assert.deepEqual(l.registry.type('local.site_visit')!.lineage, ['local.site_visit', 'event']);
  await make(l, [{ op: 'create', type: 'local.site_visit', title: 'Snowdon', props: { address: '1 High St', at: '2026-11-01T10:00:00Z' } }]);
  assert.equal((await l.search({ type: 'event' })).length, 1);
  await assert.rejects(make(l, [{ op: 'define_type', type: { id: 'thing', title: 'T', description: '' } }]), /must look like "local.my_type"/);
});

test('a connection\'s tool-call log is imported once into the activity log', async () => {
  const l = await fresh();
  const log = join(mkdtempSync(join(tmpdir(), 'lattice-audit-')), 'audit.jsonl');
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
  assert.ok(Object.keys((await callTool(l, agent, 'view', {})) as object).includes('needs_me'));
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
async function laneSetup(l: Lattice) {
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
  assert.match(text, /registered in Lattice/);
  assert.match(text, /Repository: Aperture repo/);
  assert.match(text, new RegExp(`Write unit tests \\(${made.offline}\\)`));
  assert.match(text, /Tune the solver .* waiting on: Which target\?/);
  assert.match(text, /"Live lane" .* is free/);

  const other = await sessionStart(l, agent, { title: 'Lane holder' });
  await l.claim(agent, { resource: made.lane, holder: other.run, reason: 'busy' });
  assert.match(await hookSessionStart(l, { session_id: 'def', cwd: 'C:\\elsewhere' }), /does not know a repository[\s\S]*HELD by Lane holder: do not use it/);

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

test('launching runs a headless session on a task, holding the lane and recording the outcome', async () => {
  const l = await fresh();
  const dir = mkdtempSync(join(tmpdir(), 'lattice-launch-'));
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
  assert.equal(((await VIEWS.available_now.run(l, {})) as any).held_resources.length, 0, 'the lane came back');

  const planned = await ended((await launch(l, human, { task: made.live, instructions: 'PLANONLY' })).run);
  assert.match(planned.body, /finished: The plan: do X then Y/, 'a plan-mode answer is found even though the result is empty');

  const failing = await launch(l, human, { task: made.live, mode: 'acceptEdits', instructions: 'please FAIL' });
  const failed = await ended(failing.run);
  assert.equal(failed.status, 'failed');
  assert.match(failed.body, /mode=acceptEdits/);
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
  await l.db.query(`update entity set props = props || '{"last_seen":"2020-01-01T00:00:00Z"}' where id = $1`, [run]);
  const autos = new Automations(l);
  await autos.tick();
  await autos.tick();
  unread = (await VIEWS.notifications.run(l, {})) as any[];
  const stale = unread.filter((n) => n.title.includes('gone quiet'));
  assert.equal(stale.length, 1, 'told once, not every pass');
  assert.match(stale[0].body, /still holds: Live lane/);
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

test('a project\'s questions are its open decisions and hypotheses, most-blocking first, with what waits on each', async () => {
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
    { op: 'link', type: 'depends_on', from: 'f', to: 'big' },
    { op: 'link', type: 'depends_on', from: 't', to: 'f' },
    { op: 'link', type: 'assumes', from: 't', to: 'hyp' },
    { op: 'link', type: 'tests', from: 'exp', to: 'hyp' },
  ]);

  const all = (await VIEWS.questions.run(l, {})) as any;
  assert.deepEqual(all.projects.map((p: any) => [p.title, p.questions]), [['Proj', 3], ['Other', 1]]);

  const q = (await VIEWS.questions.run(l, { project: made.p })) as any;
  assert.deepEqual(q.open.map((x: any) => x.title), ['Big', 'Hyp', 'Small'], 'what holds up the most comes first; another project\'s question is left out');
  const big = q.open[0];
  assert.deepEqual([big.kind, big.options, big.holds_up, big.waiting.map((w: any) => w.title)], ['decision', ['A', 'B'], 2, ['Feature']], 'found through what depends on it, counting what waits behind that');
  const hyp = q.open[1];
  assert.deepEqual([hyp.kind, hyp.assumed_by[0].title, hyp.tests[0].title], ['hypothesis', 'Task', 'Try it']);
  assert.deepEqual(q.settled.map((x: any) => [x.title, x.outcome, x.rationale]), [['Old', 'Yes', 'Because']]);

  await make(l, [
    { op: 'create', ref: 'ask', type: 'task', title: 'Compare A and B first' },
    { op: 'create', ref: 'aside', type: 'note', title: 'A note about it' },
    { op: 'link', type: 'about', from: 'ask', to: made.big },
    { op: 'link', type: 'about', from: 'aside', to: made.big },
  ]);
  const asked = (await VIEWS.questions.run(l, { project: made.p })) as any;
  assert.deepEqual(asked.open[0].asks.map((a: any) => [a.title, a.status]), [['Compare A and B first', 'todo']], 'a task about a question is something asked of an agent; a note is not');

  await make(l, [{ op: 'update', id: made.big, status: 'decided', props: { outcome: 'A', decided_on: '2026-10-07' } }]);
  const after = (await VIEWS.questions.run(l, { project: made.p })) as any;
  assert.deepEqual([after.open.map((x: any) => x.title), after.settled[0].title, after.settled[0].outcome], [['Hyp', 'Small'], 'Big', 'A']);
});

test('an agent may settle its own work unreviewed, but only proposes the answer to a question', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'd', type: 'decision', title: 'Where do backups go?' },
    { op: 'create', ref: 'h', type: 'hypothesis', title: 'Hooks run in the desktop app' },
    { op: 'create', ref: 't', type: 'task', title: 'Wire the upload' },
  ]);
  // As in dev mode: nothing an agent does is reviewed.
  const free = new Lattice(l.db, l.registry, { create: 'auto', update: 'auto', link: 'auto' });
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
  assert.deepEqual([gone.id, gone.note, gone.decided_by], [answer, `Already so since ${(settled as { changeset: string }).changeset}`, 'agent:lattice']);
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
  const copy = new Lattice(await openDb(), l.registry);
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
  const snapshot = async (l: Lattice) => JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' })));
  // b starts as a copy of a, then each goes its own way.
  const b = new Lattice(await openDb(), a.registry);
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
  const count = async (l: Lattice, table: string) => (await l.db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
  const before = [await count(b, 'entity'), await count(b, 'event')];

  const options = { workspace: 'default', sessionTypes: b.registry.family('sys.run') };
  const preview = await merge(b.db, from, options);
  assert.deepEqual([preview.applied, await count(b, 'entity'), await count(b, 'event')], [false, ...before], 'looking changes nothing');
  const done = await merge(b.db, from, { ...options, apply: true });
  assert.deepEqual({ ...done, applied: false, events: { ...done.events, first_seq: 0, last_seq: 0 } }, { ...preview, events: { ...preview.events, first_seq: 0, last_seq: 0 } }, 'and it does what it said it would');
  assert.deepEqual([done.entities.added, done.entities.updated, done.entities.kept_newer_here], [1, 2, 1], 'the new task; the renamed and the archived one; and the project b renamed stays');
  assert.deepEqual([done.relations, done.proposals, done.left_out.open_sessions], [{ added: 1, ended: 1 }, { added: 0, decided: 1 }, 1]);
  assert.ok(done.events.added > 0 && done.events.last_seq! - done.events.first_seq! === done.events.added - 1, 'its history arrives as one run of events');

  const title = async (l: Lattice, id: string) => (await l.entity(id))!.title;
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
  const root = mkdtempSync(join(tmpdir(), 'lattice-backup-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), join(root, 'packs'), { recursive: true });
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(root, 'packs') });
  await workspaces.create('acme', 'Acme');
  await make((await workspaces.get('acme')).lattice, [{ op: 'create', type: 'task', title: 'Theirs' }]);
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
  const root = mkdtempSync(join(tmpdir(), 'lattice-idle-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), join(root, 'packs'), { recursive: true });
  const workspaces = new Workspaces({ dataDir: join(root, 'data'), rootDir: join(root, 'workspaces'), packsDir: join(root, 'packs') });
  await workspaces.get('default');
  const acme = await workspaces.create('acme', 'Acme');
  await make(acme.lattice, [{ op: 'create', type: 'task', title: 'Theirs' }]);

  const release = workspaces.hold('acme');
  assert.deepEqual(await workspaces.closeIdle(0), [], 'not while a request is in hand, and never the default workspace');
  release();
  assert.deepEqual(await workspaces.closeIdle(60_000), [], 'not until it has been unused for long enough');
  assert.deepEqual(await workspaces.closeIdle(0), ['acme']);
  assert.deepEqual([workspaces.isOpen('acme'), workspaces.isOpen('default')], [false, true]);

  const again = await workspaces.get('acme');
  assert.deepEqual((await again.lattice.search({ type: 'task' })).map((e) => e.title), ['Theirs'], 'the data is there when it opens again');
  const session = await sessionStart(again.lattice, agent, { title: 'Working' });
  assert.deepEqual(await workspaces.closeIdle(0), [], 'a workspace with an open session stays open, so the session can be seen to go quiet');
  await sessionEnd(again.lattice, agent, { run: session.run, outcome: 'finished', summary: 'done' });

  const dir = join(root, 'backups');
  assert.deepEqual(await workspaces.closeIdle(0), ['acme']);
  await backupAll(workspaces, dir, 2);
  assert.equal(workspaces.isOpen('acme'), false, 'a backup closes what it had to open');
  await workspaces.closeAll();
});
