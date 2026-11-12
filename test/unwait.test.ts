// Settling or closing an item on a person's word takes back its waits_on to them, in the same change (bump e_2y6wwjkn).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import * as confirmPack from '../packs/attention/kernel/confirm.ts';
import { agent, fresh, human, make } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

const waits = async (l: Archipelago, id: string) =>
  (await l.db.query<{ to_id: string }>(`select to_id from relation where from_id = $1 and type = 'waits_on' and valid_to is null order by to_id`, [id])).rows.map((r) => r.to_id);

async function setup() {
  const l = await fresh();
  const me = ((await callTool(l, human, 'init', { name: 'Alex' })) as { me: string }).me;
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  const { ben } = await make(l, [{ op: 'create', ref: 'ben', type: 'person', title: 'Ben' }]);
  const item = async (type: string, title: string, on: string[]) => {
    const { it } = await make(l, [{ op: 'create', ref: 'it', type, title }, ...on.map((to) => ({ op: 'link' as const, type: 'waits_on', from: 'it', to, props: { for: 'a word' } }))]);
    return it;
  };
  return { l, me, ben, item };
}

test('a task closed on the owner’s word no longer waits on them, and the answer says so', async () => {
  const { l, me, ben, item } = await setup();
  const t = await item('task', 'Pick the fonts', [me, ben]);
  const done = (await l.change(human, { reason: 'test', ops: [{ op: 'update', id: t, status: 'done' }] })) as { unwaited?: { item: string; person: string }[] };
  assert.deepEqual(await waits(l, t), [ben], 'only the wait on the one whose word it was goes');
  assert.deepEqual(done.unwaited?.map((u) => [u.item, u.person]), [[t, me]]);
});

test('an agent on the owner’s word unwaits; on its own judgment, or short of closing, it does not', async () => {
  const { l, me, item } = await setup();
  const [said, own, moved] = [await item('decision', 'Host it where', [me]), await item('task', 'Own call', [me]), await item('task', 'Still going', [me])];
  await l.change(agent, { reason: 'test', authority: { of: 'human', basis: 'Alex in chat: static files' }, ops: [{ op: 'update', id: said, status: 'decided', props: { outcome: 'Static files', rationale: 'Nothing to run' } }] });
  await l.change(agent, { reason: 'test', authority: { of: 'agent', basis: 'It looked done' }, ops: [{ op: 'update', id: own, status: 'done' }] });
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: moved, status: 'doing' }] });
  assert.deepEqual([await waits(l, said), await waits(l, own), await waits(l, moved)], [[], [me], [me]]);
});

test('a wait the change unlinks itself is not taken back twice', async () => {
  const { l, me, item } = await setup();
  const t = await item('task', 'Both at once', [me]);
  const { rows: [r] } = await l.db.query<{ id: string }>(`select id from relation where from_id = $1 and type = 'waits_on' and valid_to is null`, [t]);
  const done = (await l.change(human, { reason: 'test', ops: [{ op: 'update', id: t, status: 'done' }, { op: 'unlink', relation: r.id }] })) as { status: string; unwaited?: unknown };
  assert.equal(done.status, 'applied');
  assert.equal(done.unwaited, undefined);
  assert.deepEqual(await waits(l, t), []);
});

test('settle confirmed: what the owner confirms no longer waits on them', async () => {
  const { l, me, item } = await setup();
  const d = await item('decision', 'Which CMS', [me]);
  await l.change(agent, { reason: 'test', authority: { of: 'agent', basis: 'Read the docs' }, ops: [{ op: 'update', id: d, status: 'decided', props: { outcome: 'None', rationale: 'Static' } }] });
  assert.deepEqual(await waits(l, d), [me], 'settled on the agent’s judgment, it still waits for the owner’s word');
  const { upto } = await confirmPack.toConfirm(kernelContext(l, 'attention'), {});
  const answer = (await callTool(l, agent, 'confirmed', { upto, basis: 'Alex in chat: fine' })) as { unwaited?: { item: string }[] };
  assert.deepEqual(await waits(l, d), []);
  assert.deepEqual(answer.unwaited?.map((u) => u.item), [d]);
});
