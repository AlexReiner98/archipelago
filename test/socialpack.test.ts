// The social pack, end to end: a conversation made from a post's page through its action, the post's count read from
// the conversations that came from it, and hours logged against posts read back by post, so a view can sum them by
// channel.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor, type Op } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';

const human: Actor = { kind: 'human', name: 'test' };

async function fresh() {
  const packs = mkdtempSync(join(tmpdir(), 'pelago-packs-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  return new Archipelago(await openDb(), new Registry(packs));
}

async function make(l: Archipelago, ops: Op[]) {
  const result = await l.change(human, { ops, reason: 'test' });
  assert.equal(result.status, 'applied');
  return (result as { created: Record<string, string> }).created;
}

const props = async (l: Archipelago, id: string) => ((await callTool(l, human, 'get', { id })) as { entity: { props: Record<string, unknown> } }).entity.props;

test('a reply that names the problem becomes a conversation from the post, and the post counts what came from it', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'p', type: 'post', title: 'Launch: LinkedIn', status: 'posted', props: { channel: 'linkedin', tag: 'linkedin-26w45-1', impressions: 1200, reactions: 30, reposts: 2 } }]);
  const say = (input: Record<string, unknown>) => callTool(l, human, 'social_conversation', { from: made.p, ...input }) as Promise<{ answer: { conversations: number }; created: { c: string } }>;

  const first = await say({ person: 'Sam Lee', problem: 'Our agents lose track of what was decided last week', date: '2026-11-04' });
  assert.equal(first.answer.conversations, 1);
  const c = (await callTool(l, human, 'get', { id: first.created.c })) as { entity: { type: string; title: string; props: Record<string, unknown> }; outgoing: { type: string; id: string }[] };
  assert.equal(c.entity.type, 'conversation');
  assert.ok(c.entity.title.length <= 60, c.entity.title);
  assert.deepEqual(c.entity.props, { person: 'Sam Lee', problem: 'Our agents lose track of what was decided last week', began: '2026-11-04', channel: 'linkedin' });
  assert.ok(c.outgoing.some((r) => r.type === 'came_from' && r.id === made.p));
  assert.equal((await props(l, made.p)).conversations, 1);

  // One linked by hand is counted too: the count is read from the links each time.
  await make(l, [
    { op: 'create', ref: 'h', type: 'conversation', title: 'Ana: no one sees the plan', props: { person: 'Ana', problem: 'No one sees the plan' } },
    { op: 'link', type: 'came_from', from: 'h', to: made.p },
  ]);
  assert.equal((await say({ person: 'Kim', problem: 'Hand-offs between sessions', channel: 'dm' })).answer.conversations, 3);
  assert.equal((await props(l, made.p)).conversations, 3);
  assert.deepEqual([(await props(l, made.p)).impressions, (await props(l, made.p)).reactions, (await props(l, made.p)).reposts], [1200, 30, 2]);

  await assert.rejects(say({ person: '', problem: 'x' }));
  await assert.rejects(callTool(l, human, 'social_conversation', { from: 'e_nothing0', person: 'A', problem: 'B' }), /No post or source/);
});

test('hours logged against two posts of one channel are read by post, and sum under the channel', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'a', type: 'post', title: 'LinkedIn 1', props: { channel: 'linkedin' } },
    { op: 'create', ref: 'b', type: 'post', title: 'LinkedIn 2', props: { channel: 'linkedin' } },
    { op: 'create', ref: 'x', type: 'post', title: 'X 1', props: { channel: 'x' } },
  ]);
  for (const [work, hours] of [[made.a, 1.5], [made.b, 2], [made.x, 0.5]] as const) await callTool(l, human, 'time_log', { work, hours, what: 'Writing and replies', date: '2026-11-04' });

  // What a view reads: the posts, and one step along part_of to the time entries in them.
  const flat = (await callTool(l, human, 'view', { name: 'flat', params: { filter: { find: ['type post'] }, walk: { over: ['part_of'], steps: 1 }, full: true } })) as { items: { id: string; type: string; fields: Record<string, unknown> }[]; links: { type: string; from: string; to: string }[] };
  const byId = new Map(flat.items.map((e) => [e.id, e]));
  const sums: Record<string, number> = {};
  for (const r of flat.links.filter((r) => r.type === 'part_of' && byId.get(r.from)?.type === 'time_entry')) {
    const channel = String(byId.get(r.to)?.fields.channel);
    sums[channel] = (sums[channel] ?? 0) + Number(byId.get(r.from)?.fields.hours);
  }
  assert.deepEqual(sums, { linkedin: 3.5, x: 0.5 });
});
