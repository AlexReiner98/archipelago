// Attention: the one standing question the kernel answers. A small map with every reason in it, read for the owner,
// for someone else, within a scope and by reason; the views it replaced answer only with where to look now; and Home
// is the core pack's screen of its pieces. It can be read latest first.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPLACED } from '../src/attention.ts';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor, type Op } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { sessionStart } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';

const human: Actor = { kind: 'human', name: 'test' };
const agent: Actor = { kind: 'agent', name: 'test' };

/** The map the demo is seeded with too: two projects, and something of every reason in the first. */
export function scenario(soon: string): Op[] {
  return [
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam' },
    { op: 'create', ref: 'site', type: 'project', title: 'Website' },
    { op: 'create', ref: 'copy', type: 'task', title: 'Write the copy', props: { due: soon } },
    { op: 'create', ref: 'fonts', type: 'task', title: 'Pick the fonts', owner: 'sam' },
    { op: 'link', type: 'waits_on', from: 'fonts', to: 'ME', props: { for: 'Your taste' } },
    { op: 'create', ref: 'launch', type: 'task', title: 'Launch', owner: 'sam' },
    { op: 'create', ref: 'contract', type: 'task', title: 'Sign the contract' },
    { op: 'link', type: 'depends_on', from: 'launch', to: 'contract' },
    { op: 'create', ref: 'host', type: 'decision', title: 'Which host?' },
    { op: 'create', ref: 'blog', type: 'hypothesis', title: 'People read the blog' },
    { op: 'create', ref: 'chore', type: 'task', title: 'Tidy the old pages' },
    { op: 'create', ref: 'news', type: 'task', title: 'Draft the newsletter', props: { tokens_estimated: 20000 } },
    { op: 'create', ref: 'cms', type: 'decision', title: 'Which CMS?' },
    ...['copy', 'fonts', 'launch', 'contract', 'host', 'blog', 'chore', 'news', 'cms'].map((ref) => ({ op: 'link' as const, type: 'part_of', from: ref, to: 'site' })),
    { op: 'create', ref: 'garden', type: 'project', title: 'Garden' },
    { op: 'create', ref: 'seeds', type: 'task', title: 'Order the seeds', props: { due: soon } },
    { op: 'link', type: 'part_of', from: 'seeds', to: 'garden' },
  ];
}

type Item = { id: string; title: string; reasons: { why: string; [k: string]: unknown }[]; top: { title: string } | null };
type Answer = { person: string | null; counts: Record<string, number>; items: Item[]; to_confirm?: { upto: number; on_agents_judgment: number } };

test('attention finds every reason, for the right person, within a scope, and the old views say where to look', async () => {
  const packs = mkdtempSync(join(tmpdir(), 'pelago-attention-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  const l = new Archipelago(await openDb(), new Registry(packs));
  const me = ((await callTool(l, human, 'init', { name: 'Alex' })) as { me: string }).me;
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const ops = scenario(soon).map((o) => (o.op === 'link' && o.to === 'ME' ? { ...o, to: me } : o));
  const made = ((await l.change(human, { reason: 'test', ops: ops.map((o) => (o.op === 'create' && ['copy', 'contract', 'chore', 'news', 'seeds'].includes(o.ref!) ? { ...o, owner: me } : o)) })) as { created: Record<string, string> }).created;
  // Nobody has touched the chore for a month; a session is at work on the newsletter; an agent settled the CMS, in a
  // workspace that applies agents' changes as made.
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);
  await l.db.query(`update entity set updated_at = now() - interval '30 days' where id = $1`, [made.chore]);
  await sessionStart(l, agent, { task: made.news, session_id: 'att' });
  await l.change(agent, { reason: 'test: settled', authority: { of: 'agent', basis: 'Read the docs' }, ops: [{ op: 'update', id: made.cms, status: 'decided', props: { outcome: 'Static files', rationale: 'Nothing to run' } }] });

  const ask = async (params: Record<string, unknown>) => (await callTool(l, human, 'view', { name: 'attention', params })) as Answer;
  const why = (a: Answer, id: string) => a.items.find((i) => i.id === id)?.reasons.map((r) => r.why) ?? [];

  const mine = await ask({ person: 'me' });
  assert.equal(mine.person, me);
  assert.deepEqual(why(mine, made.fonts), ['waits_on'], 'Sam’s task waits on me');
  assert.equal(mine.items.find((i) => i.id === made.fonts)!.reasons[0].for, 'Your taste');
  assert.deepEqual(why(mine, made.contract), ['holding_up', 'ready'], 'mine, Launch waits for it, and nothing is in its way');
  assert.ok(why(mine, made.copy).includes('due'));
  assert.deepEqual(mine.items.find((i) => i.id === made.host)!.reasons, [{ why: 'unsettled', by: 'word' }], 'a decision nobody owns is the owner’s');
  assert.deepEqual(mine.items.find((i) => i.id === made.blog)!.reasons, [{ why: 'unsettled', by: 'evidence' }]);
  assert.deepEqual(why(mine, made.chore), ['stale', 'ready']);
  assert.deepEqual(why(mine, made.news).sort(), ['ready', 'under_way']);
  assert.deepEqual(why(mine, made.cms), ['to_confirm'], 'closed, but the owner has not seen what the agent chose');
  assert.ok(mine.to_confirm!.upto > 0 && mine.to_confirm!.on_agents_judgment === 1, 'what the confirmed tool needs');
  assert.ok(!mine.items.some((i) => i.id === made.launch), 'Sam’s blocked task is Sam’s');
  assert.ok(!mine.items.some((i) => i.id === me), 'a person waited on is said so once, by waits_on, not as a row of their own');
  assert.equal(mine.items.find((i) => i.id === made.copy)!.top?.title, 'Website', 'each says what it sits in at the top');
  assert.equal(mine.items[0].reasons[0].why, 'waits_on', 'what waits on me first');

  const sams = await ask({ person: made.sam });
  assert.deepEqual(sams.items.find((i) => i.id === made.launch)!.reasons, [{ why: 'blocked', by: ['Sign the contract'] }]);
  assert.ok(!sams.items.some((i) => i.id === made.copy), 'mine is not Sam’s');

  const site = await ask({ person: 'me', within: made.site });
  assert.ok(why(site, made.copy).includes('due') && !site.items.some((i) => i.id === made.seeds), 'within a project, only its own');
  // Everyone's across the map is not weighed: it would read every open item. What the log answers is.
  await assert.rejects(ask({ reasons: ['due'] }), /for a person \(person\) or within an item/);
  const due = await ask({ person: 'me', reasons: ['due'] });
  assert.deepEqual([due.items.map((i) => i.title).sort(), Object.keys(due.counts)], [['Order the seeds', 'Write the copy'], ['due']], 'by one reason: both are the owner’s, owned by nobody');
  assert.deepEqual((await ask({ reasons: ['to_confirm'] })).items.map((i) => i.id), [made.cms], 'what to confirm is read from the log, for everyone');
  await assert.rejects(ask({ reasons: ['urgent'] }), /"urgent" is not a reason/);

  // The views attention replaced are gone, each saying what to ask now.
  for (const [name, params] of Object.entries(REPLACED))
    await assert.rejects(callTool(l, agent, 'view', { name }), (err: Error) => err.message.includes('attention answers it now') && err.message.includes(params));
  const listed = Object.keys((await callTool(l, human, 'view', {})) as Record<string, string>);
  assert.ok(listed.includes('attention') && !Object.keys(REPLACED).some((n) => listed.includes(n)));

  // For you is the core pack's screen on Home, in the sheet over the canvas (docs/ui-strategy.md): systems asking for a
  // token, what is held for the owner, your move capped at five, saved views. Your projects are the canvas itself.
  const { screens } = (await callTool(l, human, 'schema', {})) as { screens: { at?: string; pieces: { piece: string; title?: string }[] }[] };
  const home = screens.find((s) => s.at === 'home')!;
  assert.deepEqual(home.pieces.map((p) => [p.piece, p.title]), [['saved_views', 'Canvases'], ['start', 'Start here'], ['token_ask', undefined], ['held', 'Held for you'], ['attention', 'Your move']]);
  assert.equal((home.pieces[4] as { limit?: number }).limit, 5);
});

test('attention can be read latest first, each item saying when it last changed', async () => {
  const packs = mkdtempSync(join(tmpdir(), 'pelago-attention-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  const l = new Archipelago(await openDb(), new Registry(packs));
  const me = ((await callTool(l, human, 'init', { name: 'Alex' })) as { me: string }).me;
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const made = ((await l.change(human, { reason: 'test', ops: [
    { op: 'create', ref: 'old', type: 'task', title: 'Old and due', owner: me, props: { due: soon } },
    { op: 'create', ref: 'new', type: 'task', title: 'New and waiting', owner: me },
    { op: 'link', type: 'waits_on', from: 'new', to: me },
  ] })) as { created: Record<string, string> }).created;
  await l.db.query(`update entity set updated_at = now() - interval '3 days' where id = $1`, [made.new]);
  await l.db.query(`update entity set updated_at = now() - interval '1 hour' where id = $1`, [made.old]);
  const read = async (params: Record<string, unknown>) => ((await callTool(l, human, 'view', { name: 'attention', params: { person: 'me', reasons: ['waits_on', 'due'], ...params } })) as { items: { title: string; changed: string }[] }).items;
  assert.deepEqual((await read({})).map((i) => i.title), ['New and waiting', 'Old and due'], 'by default the strongest reason first');
  const latest = await read({ order: 'latest' });
  assert.deepEqual(latest.map((i) => i.title), ['Old and due', 'New and waiting']);
  assert.ok(Date.parse(latest[0].changed) > Date.parse(latest[1].changed));
});
