import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Archipelago } from '../src/pelago.ts';
import { callTool } from '../src/tools.ts';
import { importAudit } from '../src/audit.ts';
import { human, agent, fresh, make } from './map.ts';

test('flavours inherit fields and statuses, and are found through the parent', async () => {
  const l = await fresh();
  const bug = l.registry.type('bug')!;
  assert.deepEqual(bug.lineage, ['bug', 'issue', 'work']);
  assert.ok(bug.fields.severity, 'inherits issue.severity');
  assert.ok(bug.fields.repro, 'adds its own field');
  assert.deepEqual(bug.statuses, l.registry.type('issue')!.statuses);

  await make(l, [
    { op: 'create', type: 'bug', title: 'Crash on load', props: { severity: 'high' } },
    { op: 'create', type: 'issue', title: 'Slow builds' },
  ]);
  assert.equal((await l.search({ type: 'issue' })).length, 2);
  assert.equal((await l.search({ type: 'bug' })).length, 1);
});

test('a flavour can override an inherited default', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'lane', type: 'resource', title: 'Lane' },
    { op: 'create', ref: 'conn', type: 'connection', title: 'Conn' },
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

test('what the page follows moves when a change is proposed, decided or applied, and not otherwise', async () => {
  const l = await fresh();
  const stamp = async () => {
    const t = (await callTool(l, human, 'tail', {})) as { pos: number; queue: string };
    return `${t.pos}.${t.queue}`;
  };
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
  const result = await l.change(agent, { ops: [{ op: 'create', type: 'bug', title: 'mask misregistration' }], reason: 'test' });
  assert.match(result.warnings[0], /possible duplicate of existing issue "Mask misregistration"/);
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
  const made = await make(l, [{ op: 'create', ref: 'c', type: 'connection', title: 'Apex', props: { audit_log: log } }]);

  assert.deepEqual(await importAudit(l, agent, { connection: made.c }), { imported: 2, skipped: 1, path: log });
  writeFileSync(log, [line('2026-10-01T10:00:00.000Z', 'nodegraph_add_node'), line('2026-10-01T10:00:09.000Z', 'form_snapshot')].join('\n'));
  assert.equal((await importAudit(l, agent, { connection: made.c })).imported, 1, 'only entries after the cursor');

  const external = (await l.events({ origin: 'external' })) as any[];
  assert.deepEqual(external.map((e) => e.action), ['form_snapshot', 'run_command', 'nodegraph_add_node']);
  assert.equal(external[0].actor, 'external:Apex');
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
  assert.equal((await l.search({ type: 'source' })).length, 2, 'the same uri is recorded once');
});

test('a reviewer can correct a proposal while approving it', async () => {
  const l = await fresh();
  const proposed = await l.change(agent, {
    reason: 'test',
    ops: [{ op: 'create', ref: 'f', type: 'feature', title: 'Presets', status: 'planned' }],
  });
  const id = (proposed as { proposal: string }).proposal;
  await assert.rejects(
    l.decide(human, { proposal: id, approve: true, ops: [{ op: 'create', type: 'feature', title: 'Presets', status: 'nonsense' }] }),
    /status "nonsense"/,
  );
  assert.equal((await l.proposals()).length, 1, 'a rejected correction leaves the proposal pending');

  await l.decide(human, { proposal: id, approve: true, ops: [{ op: 'create', ref: 'f', type: 'feature', title: 'Presets', status: 'shipped' }] });
  const [feature] = await l.search({ type: 'feature' });
  assert.equal(feature.status, 'shipped');
  const [event] = (await l.events({ target: feature.id })) as any[];
  assert.equal(event.actor, 'agent:test');
  assert.equal(event.detail.revised_by, 'human:test');
});

