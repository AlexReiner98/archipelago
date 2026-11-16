// Two reads a canvas makes, made cheap (task e_p3ncqu87): every saved view's query checked in one call
// (answer.flat_checks), and up to where the owner last confirmed found by its index under the row policy
// (pelago_action_ops, packs/surface/kernel/action-ops.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool } from '../packs/surface/kernel/tools.ts';
import * as confirmPack from '../packs/attention/kernel/confirm.ts';
import * as queryAnswers from '../packs/query/kernel/answers.ts';
import { settledUnconfirmed } from '../packs/surface/kernel/packreads-log.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';
import { agent, fresh, human, make } from './map.ts';

test('the lenses are checked in one call, each answered in its order as flat_check answers it alone', async () => {
  const l = await fresh();
  const ctx = kernelContext(l, 'query');
  const lenses = [{ filter: { find: ['type task'] } }, { filter: { find: ['no such term'] } }, { filter: { find: ['type task'] }, walk: { over: ['part_of'], steps: 1 } }];
  const { problems } = await queryAnswers.flatChecks(ctx, { lenses });
  const alone = await Promise.all(lenses.map(async (lens) => (await queryAnswers.flatCheck(ctx, lens)).problem ?? null));
  assert.deepEqual(problems, alone);
  assert.deepEqual(problems.map((p) => p === null), [true, false, true], 'only the lens with a term no pack provides is refused');
  assert.deepEqual((await queryAnswers.flatChecks(ctx, {})).problems, [], 'no lenses, no problems');
});

test('what the owner confirmed is read as they see it, through the ops found by their action', async () => {
  const l = await fresh();
  const me = ((await callTool(l, human, 'init', { name: 'Alex' })) as { me: string }).me;
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  const { d } = await make(l, [{ op: 'create', ref: 'd', type: 'decision', title: 'Which CMS' }]);
  await l.change(agent, { reason: 'test', authority: { of: 'agent', basis: 'Read the docs' }, ops: [{ op: 'update', id: d, status: 'decided', props: { outcome: 'None', rationale: 'Static' } }] });
  const owner = l.as(me);
  assert.deepEqual((await settledUnconfirmed(owner, 40)).questions.map((q) => q.id), [d], 'settled by an agent, not yet confirmed');
  const { upto } = await confirmPack.toConfirm(kernelContext(l, 'attention'), {});
  await callTool(l, agent, 'confirmed', { upto, basis: 'Alex in chat: fine' });
  assert.deepEqual((await settledUnconfirmed(owner, 40)).questions, [], 'confirmed: the mark is found, and nothing is left to confirm');
  const { rows } = await l.db.query<{ n: number }>(`select count(*)::int as n from pelago_action_ops(array['changes.seen', 'questions.confirmed'], array['settings', 'activity'])`);
  assert.ok(rows[0].n >= 1, 'the mark is found by its action');
});
