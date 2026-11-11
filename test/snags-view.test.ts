// The refine pack's snags view, through the pack host: sessions file bumps as issues that name what they touched (the
// issue type here a test pack's, declaring touches as the work pack does), a second adds to one, and `query snags`
// answers them grouped with the runs that wrote them; inside a feature, a bump that names nothing is counted apart.
// The pack's rule touches_form refuses a value in another form. With refine out, nothing of it is said.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry } from '../src/packs.ts';
import { setPack } from '../src/packstate.ts';
import { sessionStart } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

type Group = { touches: string; count: number; snags: { id: string }[]; runs: { id: string; title?: string; packs?: unknown }[] };
type Answer = { open: number; groups: Group[]; untouched: { count: number; snags: { id: string }[] }; within?: string };

/** An issue as the work pack declares it, with touches. */
const TRACKER = {
  id: 'tracker',
  version: '0.1.0',
  title: 'Tracker',
  description: 'Issues, for the snags test.',
  requires: ['core'],
  types: [{ id: 'issue', extends: 'work', title: 'Issue', description: 'A problem observed.', statuses: { open: ['open', 'investigating'], closed: ['resolved'] }, fields: { severity: { type: 'enum', values: ['low', 'medium', 'high'] }, touches: { type: 'string' } } }],
};

const mapWithRefine = async () => {
  const l = await freshWith(new Registry(packsWith(TRACKER as never)));
  await callTool(l, human, 'init', { name: 'Alex' });
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  for (const pack of ['tracker', 'refine']) await setPack(l, human, { pack, on: true });
  return l;
};

test('query snags groups open bumps by what they touched, with the runs that wrote them', async () => {
  const l = await mapWithRefine();
  const { friction } = await make(l, [{ op: 'create', ref: 'friction', type: 'task', title: 'Friction' }]);

  const one = await sessionStart(l, agent, { session_id: 'one', cwd: 'C:/work/app' });
  const filed = await l.change(agent, {
    run: one.run,
    reason: 'Record bumps',
    ops: [
      { op: 'create', ref: 'a', type: 'issue', title: 'A note is refused at four lines', props: { severity: 'medium', touches: 'tool:change rule:finding_note' } },
      { op: 'create', ref: 'b', type: 'issue', title: 'A whole body is resent to change a line', props: { severity: 'high', touches: 'tool:change' } },
      { op: 'create', ref: 'c', type: 'issue', title: 'A vague bump names nothing' },
      { op: 'link', type: 'part_of', from: 'a', to: friction },
      { op: 'link', type: 'part_of', from: 'b', to: friction },
      { op: 'link', type: 'part_of', from: 'c', to: friction },
    ],
  });
  assert.equal(filed.status, 'applied', JSON.stringify(filed));
  const { a, b, c } = (filed as { created: Record<string, string> }).created;

  // A second session hits the same snag and adds to it.
  const two = await sessionStart(l, agent, { session_id: 'two', cwd: 'C:/work/app' });
  assert.equal((await l.change(agent, { run: two.run, reason: 'Seen again', ops: [{ op: 'update', id: b, append: 'Seen again.' }] })).status, 'applied');

  const all = (await callTool(l, agent, 'query', { name: 'snags' })) as Answer;
  assert.deepEqual(all.groups.map((g) => [g.touches, g.count]), [['tool:change', 2], ['rule:finding_note', 1]]);
  const change = all.groups[0];
  assert.deepEqual(change.snags.map((s) => s.id), [b, a], 'the heaviest first');
  assert.deepEqual(change.runs.map((r) => r.id).sort(), [one.run, two.run].sort(), 'both sessions wrote a snag on change');
  assert.ok(Array.isArray(change.runs[0].packs), 'a run carries the packs it ran under');
  assert.deepEqual(all.groups[1].runs.map((r) => r.id), [one.run]);
  assert.equal(all.untouched.count, 0, 'without within, only the bumps that name what they touched');

  const inside = (await callTool(l, agent, 'query', { name: 'snags', params: { within: friction } })) as Answer;
  assert.equal(inside.within, friction);
  assert.equal(inside.open, 3);
  assert.deepEqual(inside.untouched.snags.map((s) => s.id), [c]);

  // A resolved bump leaves the answer.
  await make(l, [{ op: 'update', id: a, status: 'resolved' }]);
  const after = (await callTool(l, agent, 'query', { name: 'snags' })) as Answer;
  assert.deepEqual(after.groups.map((g) => [g.touches, g.count]), [['tool:change', 1]]);
});

test('a touches value the snags view cannot read is refused; with refine out, nothing of it is said', async () => {
  const l = await mapWithRefine();
  const filing = (touches: string) => l.change(human, { reason: 'test', ops: [{ op: 'create', type: 'issue', title: 'A bump', props: { touches } }] });
  await assert.rejects(filing('the change tool'), /touches names what a snag touched/);
  assert.equal((await filing('tool:change')).status, 'applied');

  await setPack(l, human, { pack: 'refine', on: false });
  assert.equal((await filing('the change tool')).status, 'applied', 'the form is refine’s rule');
  await assert.rejects(callTool(l, agent, 'query', { name: 'snags' }), /No view "snags"/);
});
