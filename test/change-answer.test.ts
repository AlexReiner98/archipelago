// A change's answer says what it did and why (task e_km4nczuh): one that applied says so whatever fails after its log
// entry, a {ref} in its props is the id it makes, and a rule a setting lifted is named as what let it through.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Actor } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { onTypesChanged } from '../packs/loader/kernel/type-items.ts';
import { syncTypes } from '../packs/loader/kernel/typetable.ts';
import { fresh, human } from './map.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const agent: Actor = { kind: 'agent', name: 'test' };

test('a change that made a type answers applied, though what follows its log entry fails', async () => {
  const l = await fresh();
  onTypesChanged(async () => { throw new Error('permission denied for table type_def'); });
  try {
    const done = (await l.change(human, { reason: 'test', ops: [{ op: 'define_type', type: { id: 'local.visit', title: 'Visit', extends: 'event' } } as never] })) as { status: string; warnings: string[] };
    assert.equal(done.status, 'applied');
    assert.ok(done.warnings.some((w) => /Applied, but .*type_def/.test(w)), 'the failure is said as a warning');
  } finally {
    onTypesChanged(syncTypes);
  }
  assert.ok(l.registry.type('local.visit'), 'the registry has the type');
});

test('a {ref} in props is the id of what the change makes, at any depth', async () => {
  const l = await fresh();
  const done = await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'aim', title: 'Garden' },
      { op: 'create', ref: 'v', type: 'lens', title: 'The garden', props: { filter: { find: ['in {p}', 'id {p}'] }, walk: { over: [], steps: 0 } } },
    ],
  }) as { created: Record<string, string> };
  const lens = (await l.entity(done.created.v))!;
  assert.deepEqual((lens.props.filter as { find: string[] }).find, [`in ${done.created.p}`, `id ${done.created.p}`]);
  const later = await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'q', type: 'aim', title: 'Orchard' }, { op: 'update', id: lens.id, props: { filter: { find: ['in {q}', '{nobody}'] } } }] }) as { created: Record<string, string> };
  assert.deepEqual(((await l.entity(lens.id))!.props.filter as { find: string[] }).find, [`in ${later.created.q}`, '{nobody}'], 'a brace that names no ref is left alone');
});

test('a rule lifted by a setting is named in the answer as what let the change through', async () => {
  const l = await fresh();
  await callTool(l, owner, 'workspace_set', { agent_changes: 'apply', agent_code: true });
  const made = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'create', type: 'layout', title: 'Coded', props: { code: 'export default () => []' } }] })) as { status: string; let_through?: { rule: string; by: string }[] };
  assert.equal(made.status, 'applied');
  assert.ok(made.let_through?.some((r) => r.rule === 'code_runs' && r.by === 'agent_code'), JSON.stringify(made.let_through));
  await callTool(l, owner, 'workspace_set', { agent_code: false });
  const held = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'create', type: 'layout', title: 'Coded again', props: { code: 'export default () => []' } }] })) as { status: string; held_by?: { rule: string } };
  assert.deepEqual([held.status, held.held_by?.rule], ['proposed', 'code_runs']);
});
