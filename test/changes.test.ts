import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { heldResources } from '../src/blocking.ts';
import { openDb } from '../src/db.ts';
import { Archipelago } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';
import { human, agent, fresh, attend, make } from './map.ts';

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
  await make(l, [{ op: 'create', type: 'work.task', title: 'Seen after the move' }]);
  assert.equal((await l.as('nobody').db.query(`select 1 from entity where title = 'Seen after the move'`)).rows.length, 1);
  await db.close();
});

test('flavours inherit fields and statuses, and are found through the parent', async () => {
  const l = await fresh();
  const bug = l.registry.type('software.bug')!;
  assert.deepEqual(bug.lineage, ['software.bug', 'work.issue', 'work']);
  assert.ok(bug.fields.severity, 'inherits issue.severity');
  assert.ok(bug.fields.repro, 'adds its own field');
  assert.deepEqual(bug.statuses, l.registry.type('work.issue')!.statuses);

  await make(l, [
    { op: 'create', type: 'software.bug', title: 'Crash on load', props: { severity: 'high' } },
    { op: 'create', type: 'work.issue', title: 'Slow builds' },
  ]);
  assert.equal((await l.search({ type: 'work.issue' })).length, 2);
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
        { op: 'create', ref: 't', type: 'work.task', title: 'Good task' },
        { op: 'create', type: 'work.task', title: 'Bad status', status: 'finished' },
        { op: 'create', type: 'work.task', title: 'Bad field', props: { colour: 'red', due: 'tomorrow' } },
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
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'c', type: 'company', title: 'C' },
    { op: 'link', type: 'works_at', from: 'a', to: 'c' },
  ]), /must start from person, not work\.task/);
  await assert.rejects(l.change(human, { ops: [{ op: 'create', type: 'work.task', title: 'A' }], reason: ' ' }), /needs a reason/);
});

test('an agent change becomes a proposal; a human approves it, minus exclusions', async () => {
  const l = await fresh();
  const proposed = await l.change(agent, {
    reason: 'Read the handoff doc',
    source: { uri: 'docs/handoff.md', kind: 'file' },
    ops: [
      { op: 'create', ref: 'proj', type: 'work.project', title: 'Shadow' },
      { op: 'create', ref: 'a', type: 'work.task', title: 'Fix parity' },
      { op: 'create', ref: 'b', type: 'work.task', title: 'Wrong guess' },
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
  const tasks = await l.search({ type: 'work.task' });
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

  const proposed = await l.change(agent, { reason: 'test', ops: [{ op: 'create', type: 'work.task', title: 'A' }] });
  seen.push(await stamp());
  await l.decide(human, { proposal: (proposed as { proposal: string }).proposal, approve: false });
  seen.push(await stamp());
  await make(l, [{ op: 'create', type: 'work.task', title: 'B' }]);
  seen.push(await stamp());
  assert.equal(new Set(seen).size, seen.length, `each write gives a new stamp: ${seen.join(', ')}`);
});

test('policy can let agents apply some ops directly, or forbid them', async () => {
  const l = await fresh();
  const loose = new Archipelago(l.db, l.registry, { create: 'auto', merge: 'forbidden' });
  const made = await loose.change(agent, { ops: [{ op: 'create', ref: 'x', type: 'work.note', title: 'X' }], reason: 'test' });
  assert.equal(made.status, 'applied');
  const x = (made as { created: Record<string, string> }).created.x;
  const y = (await make(l, [{ op: 'create', ref: 'y', type: 'work.note', title: 'Y' }])).y;
  await assert.rejects(loose.change(agent, { ops: [{ op: 'merge', keep: x, drop: y }], reason: 'test' }), /forbids/);
  const mixed = await loose.change(agent, {
    ops: [{ op: 'create', type: 'work.note', title: 'Z' }, { op: 'archive', id: y }],
    reason: 'test',
  });
  assert.equal(mixed.status, 'proposed', 'one op needing approval holds the whole change');
});

test('possible duplicates are flagged, across flavours', async () => {
  const l = await fresh();
  await make(l, [{ op: 'create', type: 'work.issue', title: 'Mask misregistration' }]);
  const result = await l.change(agent, { ops: [{ op: 'create', type: 'software.bug', title: 'mask misregistration' }], reason: 'test' });
  assert.match(result.warnings[0], /possible duplicate of existing work\.issue "Mask misregistration"/);
});

test('blockers are derived, and roots are what has to move first', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Me' },
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam' },
    { op: 'create', ref: 'ship', type: 'work.task', title: 'Ship release', owner: 'me' },
    { op: 'create', ref: 'sign', type: 'work.task', title: 'Sign installer', owner: 'me' },
    { op: 'create', ref: 'cert', type: 'work.decision', title: 'Which certificate?', owner: 'sam' },
    { op: 'create', ref: 'free', type: 'work.task', title: 'Write notes', owner: 'me' },
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
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'B' },
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
    { op: 'create', ref: 'live1', type: 'work.task', title: 'Capture parity probe' },
    { op: 'create', ref: 'live2', type: 'work.task', title: 'Debug conduit' },
    { op: 'create', ref: 'offline', type: 'work.task', title: 'Write unit tests' },
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
    { op: 'create', type: 'work.task', title: 'File return', props: { due: '2020-01-01' } },
    { op: 'create', type: 'work.task', title: 'Far off', props: { due: '2999-01-01' } },
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
    { op: 'create', ref: 't', type: 'work.task', title: 'Reply to Sam', owner: 's2' },
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
      { op: 'create', ref: 'a', type: 'work.note', title: 'From the roadmap' },
      { op: 'create', ref: 'b', type: 'work.note', title: 'From the readme', source: { uri: 'README.md', kind: 'file' } },
      { op: 'create', ref: 'c', type: 'work.note', title: 'Also from the readme', source: { uri: 'README.md' } },
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

