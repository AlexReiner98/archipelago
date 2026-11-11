// The snags view (src/snags.ts, core.snags): a session files snags that name what they touched, a second adds to one,
// and `query snags` answers them grouped with the runs that wrote them; inside a feature, a snag that names nothing is
// counted apart. A touches value the form does not read is refused by core's rule touches_form.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionStart } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { agent, fresh, human, make } from './map.ts';

type Group = { touches: string; count: number; snags: { id: string }[]; runs: { id: string; title?: string }[] };
type Answer = { open: number; groups: Group[]; untouched: { count: number; snags: { id: string }[] }; within?: string };

test('query snags answers the open snags grouped by what they touched, with the runs that wrote them', async () => {
  const l = await fresh();
  await callTool(l, human, 'init', { name: 'Alex' });
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  const { friction } = await make(l, [{ op: 'create', ref: 'friction', type: 'task', title: 'Friction' }]);

  const one = await sessionStart(l, agent, { session_id: 'one', cwd: 'C:/work/app' });
  const filed = await l.change(agent, {
    run: one.run,
    reason: 'Record bumps',
    ops: [
      { op: 'create', ref: 'a', type: 'finding', title: 'A note is refused at four lines', props: { value: 'refused', value_type: 'text', touches: 'tool:change rule:finding_note' } },
      { op: 'create', ref: 'b', type: 'finding', title: 'A whole body is resent to change a line', props: { value: 'resent', value_type: 'text', touches: 'tool:change' } },
      { op: 'create', ref: 'c', type: 'finding', title: 'A vague bump names nothing', props: { value: 'vague', value_type: 'text' } },
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
  assert.deepEqual(change.snags.map((s) => s.id).sort(), [a, b].sort());
  assert.deepEqual(change.runs.map((r) => r.id).sort(), [one.run, two.run].sort(), 'both sessions wrote a snag on change');
  assert.deepEqual(all.groups[1].runs.map((r) => r.id), [one.run]);
  assert.equal(all.untouched.count, 0, 'without within, only the snags that name what they touched');

  const inside = (await callTool(l, agent, 'query', { name: 'snags', params: { within: friction } })) as Answer;
  assert.equal(inside.within, friction);
  assert.equal(inside.open, 3);
  assert.deepEqual(inside.untouched.snags.map((s) => s.id), [c]);

  // A closed snag leaves the answer.
  await make(l, [{ op: 'update', id: a, status: 'superseded' }]);
  const after = (await callTool(l, agent, 'query', { name: 'snags' })) as Answer;
  assert.deepEqual(after.groups.map((g) => [g.touches, g.count]), [['tool:change', 1]]);
});

test('a touches value the snags view cannot read is refused', async () => {
  const l = await fresh();
  const filing = (touches: string) => l.change(human, { reason: 'test', ops: [{ op: 'create', type: 'finding', title: 'A bump', props: { value: 'x', value_type: 'text', touches } }] });
  await assert.rejects(filing('the change tool'), /touches names what a snag touched/);
  assert.equal((await filing('tool:change')).status, 'applied');
});
