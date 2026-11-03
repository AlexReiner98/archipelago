// A held change taken back by its proposer, and a newer one that says which older one it covers (src/withdraw.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Op } from '../src/pelago.ts';
import { callTool } from '../src/tools.ts';
import { covering } from '../src/withdraw.ts';
import { human, agent, fresh, make, all, replayed } from './map.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 12, minute));
const held = (id: string, minute: number, ops: Op[], actor = 'agent:test') => ({ id, ts: at(minute), actor, ops });

test('a newer held change covers an older one of the same proposer that it sets again whole', () => {
  const covers = covering([
    held('p_old', 1, [{ op: 'update', id: 'e_s', props: { code: 'a' } }]),
    held('p_new', 2, [{ op: 'update', id: 'e_s', props: { code: 'b' } }, { op: 'update', id: 'e_t', title: 'Sidebar' }]),
    held('p_more', 3, [{ op: 'update', id: 'e_s', props: { width: 2 } }]),
    held('p_theirs', 0, [{ op: 'update', id: 'e_s', props: { code: 'c' } }], 'agent:other'),
    held('p_make', 0, [{ op: 'create', type: 'task', title: 'New' }]),
    held('p_make2', 4, [{ op: 'create', type: 'task', title: 'New' }]),
  ]);
  assert.deepEqual(Object.fromEntries(covers), { p_new: ['p_old'] }, 'not one that asks for more, nor another proposer’s, nor one that makes something');
});

test('an agent withdraws its own held change, never another’s, and a newer one says what it covers', async () => {
  const l = await fresh();
  const { s } = await make(l, [{ op: 'create', ref: 's', type: 'task', title: 'Ridges' }]);
  const change = (who: typeof agent, reason: string, ops: Op[]) => callTool(l, who, 'change', { reason, ops, hold: true }) as Promise<any>;
  const older = await change(agent, 'taller islands', [{ op: 'update', id: s, title: 'Taller' }]);
  assert.equal(older.covers, undefined);
  const newer = await change(agent, 'taller islands and the sidebar', [{ op: 'update', id: s, title: 'Taller, sidebar', body: 'And the sidebar.' }]);
  assert.deepEqual(newer.covers, [older.proposal], 'the answer says which older one it covers');
  const listed = (await callTool(l, agent, 'query', { name: 'proposals' })) as any[];
  assert.deepEqual(listed.map((p) => [p.id, p.covers, p.covered_by]), [[older.proposal, undefined, [newer.proposal]], [newer.proposal, [older.proposal], undefined]]);

  const other = { kind: 'agent', name: 'other' } as const;
  await assert.rejects(callTool(l, other, 'revise', { action: 'withdraw', params: { proposal: older.proposal } }), /only its proposer may withdraw it/);
  const gone = (await callTool(l, agent, 'revise', { action: 'withdraw', params: { proposal: older.proposal } })) as any;
  assert.deepEqual(gone, { proposal: older.proposal, status: 'withdrawn', note: `Covered by ${newer.proposal}` });
  assert.deepEqual((await l.proposals()).map((p) => p.id), [newer.proposal]);
  const [w] = await l.proposals({ status: 'withdrawn' });
  assert.deepEqual([w.decided_by, w.note], ['agent:test', `Covered by ${newer.proposal}`]);
  assert.equal((await l.entity(s))!.title, 'Ridges', 'withdrawing applies nothing');
  await assert.rejects(callTool(l, agent, 'revise', { action: 'withdraw', params: { proposal: older.proposal } }), /already withdrawn/);
  await assert.rejects(l.decide(human, { proposal: older.proposal, approve: true }), /already withdrawn/);

  // The log keeps it as an entry of no facts, so the queue rebuilt from the log says the same.
  const said = (await all(l)).find((e) => (e.rule as any)?.outcome === 'withdrawn')!;
  assert.deepEqual([said.facts, (said.rule as any).proposal, (said.rule as any).by], [[], older.proposal, 'agent:test']);
  const { live, replay } = await replayed(l);
  assert.deepEqual(replay.queue, live.queue);
  const own = await callTool(l, agent, 'revise', { action: 'withdraw', params: { proposal: newer.proposal, reason: 'Not needed after all' } });
  assert.deepEqual(own, { proposal: newer.proposal, status: 'withdrawn', note: 'Not needed after all' });
});
