// What rides a change (write.follow.rides, docs/kernel-packs.md "Write-path hooks"): the waits pack's unwait and the
// placement pack's sources take the verdict of the change that caused them. The log they leave is pinned here as it
// was when both ran inline in the apply loop: the same facts, in the same order, in the same change set, held with a
// held change and applied when it is approved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, all, fresh, human, make } from './map.ts';

/** An entry as the test pins it: every id named by the order it first appears, the times and hashes left out. */
function pinned(entries: Record<string, unknown>[]): unknown {
  const names = new Map<string, string>();
  const name = (id: string) => (names.has(id) || names.set(id, `${id.slice(0, 1)}${names.size}`), names.get(id)!);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(/\b[ecrp]_[a-z0-9]{8}\b/g, name);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !['at', 'prev', 'hash', 'pos', 'ws', 'v', 'base', 'keys', 'proposal_hash'].includes(k)).map(([k, x]) => [walk(k) as string, walk(x)]));
    return v;
  };
  return walk(entries);
}

async function setup(agents: 'apply' | 'hold') {
  const l = await fresh();
  const me = ((await callTool(l, human, 'init', { name: 'Alex' })) as { me: string }).me;
  await l.db.query(`insert into setting (key, value) values ('agent_changes', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(agents)]);
  const made = await make(l, [
    { op: 'create', ref: 'ben', type: 'person', title: 'Ben' },
    { op: 'create', ref: 't', type: 'task', title: 'Pick the fonts' },
    { op: 'create', ref: 'd', type: 'decision', title: 'Host it where' },
    { op: 'create', ref: 'n', type: 'finding', title: 'A note' },
    { op: 'link', type: 'waits_on', from: 't', to: me, props: { for: 'a word' } },
    { op: 'link', type: 'waits_on', from: 't', to: 'ben', props: { for: 'a word' } },
    { op: 'link', type: 'waits_on', from: 'd', to: me, props: { for: 'a word' } },
  ]);
  return { l, me, t: made.t, d: made.d, n: made.n };
}

const since = async (l: Archipelago, stream: 'facts' | 'pending', n: number) => (await all(l, stream)).slice(n) as unknown as Record<string, unknown>[];

test('a settle on the owner’s word, with sources: the facts it appends, as they were inline', async () => {
  const { l, t, d, n } = await setup('apply');
  const before = (await all(l)).length;
  const done = (await l.change(human, {
    reason: 'pin', source: { uri: 'https://example.com/a', title: 'The thread' },
    ops: [
      { op: 'update', id: t, status: 'done' },
      { op: 'update', id: n, title: 'A note, read' },
      { op: 'link', type: 'about', from: n, to: d, source: { uri: 'https://example.com/b', kind: 'web' } },
      { op: 'create', ref: 'x', type: 'task', title: 'Follow up', source: { uri: 'https://example.com/a' } },
    ],
  })) as { status: string; unwaited?: { item: string }[] };
  assert.equal(done.status, 'applied');
  assert.deepEqual(done.unwaited?.map((u) => u.item), [t]);
  assert.deepEqual(pinned(await since(l, 'facts', before)), PINNED_APPLIED);
});

test('held under npm start, an agent’s settle holds what rides it; approved, it appends the same facts', async () => {
  const { l, me, d } = await setup('hold');
  const [facts, pending] = [(await all(l)).length, (await all(l, 'pending')).length];
  const held = (await l.change(agent, { reason: 'pin', authority: { of: 'human', basis: 'Alex in chat: static files' }, source: { uri: 'https://example.com/c' }, ops: [{ op: 'update', id: d, status: 'decided', props: { outcome: 'Static files', rationale: 'Nothing to run' } }] })) as { status: string; proposal: string };
  assert.equal(held.status, 'proposed');
  assert.equal((await l.db.query(`select 1 from relation where from_id = $1 and type = 'waits_on' and valid_to is null`, [d])).rows.length, 1, 'held: it still waits');
  const approved = (await l.decide(human, { proposal: held.proposal, approve: true })) as { status?: string; unwaited?: unknown[] };
  assert.equal((await l.db.query(`select 1 from relation where from_id = $1 and type = 'waits_on' and valid_to is null`, [d])).rows.length, 0, 'approved: it waits no more');
  assert.deepEqual(approved.unwaited, [{ item: d, person: me, relation: (approved.unwaited?.[0] as { relation: string }).relation }]);
  assert.deepEqual(pinned([...(await since(l, 'pending', pending)), ...(await since(l, 'facts', facts))]), PINNED_HELD);
});

// Taken from the inline apply loop (kernel-packs b2e3f717), before either moved.
const source = (e: string, title: string, uri: string): unknown[] => [['+', e, 'type', 'source'], ['+', e, 'title', title], ['+', e, 'status', 'recorded'], ['+', e, 'visibility', 'private'], ['+', e, 'uri', uri]];
const PINNED_APPLIED: unknown = [{
  id: 'c0', rule: { spared: [], outcome: 'apply' }, actor: { id: 'human:test' }, action: null, reason: 'pin', source: 'e1', undoes: null, authority: { of: 'human', who: 'human:test' }, stream: 'facts',
  facts: [
    ...source('e1', 'The thread', 'https://example.com/a'),
    ['+', 'e2', 'status', 'done'], ['-', 'r3', 'link'],
    ['+', 'e4', 'title', 'A note, read'],
    ...source('e5', 'https://example.com/b', 'https://example.com/b'), ['+', 'e5', 'kind', 'web'],
    ['+', 'r6', 'link', ['about', 'e4', 'e7']], ['+', 'r6', 'source', 'e5'],
    ['+', 'e8', 'type', 'task'], ['+', 'e8', 'title', 'Follow up'], ['+', 'e8', 'status', 'todo'], ['+', 'e8', 'visibility', 'private'], ['+', 'e8', 'source', 'e1'],
  ],
}];
const settled = [...source('e1', 'https://example.com/c', 'https://example.com/c'), ['+', 'e2', 'status', 'decided'], ['+', 'e2', 'outcome', 'Static files'], ['+', 'e2', 'rationale', 'Nothing to run'], ['-', 'r3', 'link']];
const PINNED_HELD: unknown = [
  {
    id: 'p0', ids: { 'source https://example.com/c': 'e1' }, ops: [{ op: 'update', id: 'e2', status: 'decided', props: { outcome: 'Static files', rationale: 'Nothing to run' } }],
    actor: { id: 'agent:test' }, action: null, reason: 'pin', source: { uri: 'https://example.com/c' }, undoes: null,
    held_by: { say: 'Settling "Host it where" is the owner\'s: the agent proposes the answer, and they confirm it.', pack: 'core', rule: 'settle' },
    warnings: [], authority: { of: 'human', basis: 'Alex in chat: static files', stated_by: 'agent:test' }, private_to: null, stream: 'pending', facts: settled,
  },
  {
    id: 'c4', rule: { by: 'human:test', except: [], held_by: { pack: 'core', rule: 'settle' }, outcome: 'approved', revised: false, proposal: 'p0' },
    actor: { id: 'agent:test' }, action: null, reason: 'pin', source: 'e1', undoes: null, authority: { of: 'human', who: 'human:test' }, stream: 'facts', facts: settled,
  },
];
