// The usage view (src/usage.ts): a member and their agents read how much of each limit their workspace uses and what
// it is made of, the same answer through the page's call and an agent's; what they cannot see is summed with no
// title; members and where the plan is managed are an admin's. And the counts it rests on (src/bytes.ts): each
// append adds what it stores, and a count made again from the log agrees with them.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { recountBytes } from '../src/bytes.ts';
import { runAct } from '../src/server-acts.ts';
import { loadServerPacks } from '../src/server-packs.ts';
import { serve } from './serve.ts';

const FIXTURES = join(import.meta.dirname, 'server-packs');
before(() => Object.assign(process.env, { PELAGO_SERVER_PACKS: FIXTURES }));
after(() => void delete process.env.PELAGO_SERVER_PACKS);

const SECRET = 'Acquisition of Brightwater';

test('a member reads their workspace’s use and what it is made of, and nothing private of anyone else', async () => {
  const { workspaces, call } = await serve('tokens');
  const pack = loadServerPacks([FIXTURES]).packs[0].file;
  const act = (name: string, input: Record<string, unknown>) => runAct(workspaces, pack, name, input);
  const { workspace } = (await act('workspace.create', { name: 'Use Co' })) as { workspace: { id: string } };
  const ws = await workspaces.get(workspace.id);
  const admit = async (email: string, admin: boolean) => ((await act('workspace.admit', { workspace: ws.id, email, admin })) as { person: string }).person;
  const ola = await admit('ola@use.example', true);
  const kim = await admit('kim@use.example', false);
  const owner = (await createToken(ws.pelago.db, ws.id, { kind: 'human', name: 'ola@use.example', entity: ola, admin: true })).token;
  const member = (await createToken(ws.pelago.db, ws.id, { kind: 'human', name: 'kim@use.example', entity: kim })).token;
  const agent = (await createToken(ws.pelago.db, ws.id, { kind: 'agent', name: 'claude', entity: kim })).token;
  await act('workspace.limit', { workspace: ws.id, plan: 'Solo', manage: 'https://seller.example/billing', storage: 500e6, sessions: 5, requests: 300, looks: 30, members: 3 });

  // The owner keeps a large private item; the member a shared one.
  const made = await call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', ref: 'x', type: 'resource', title: SECRET, visibility: 'private', body: 'Terms. '.repeat(3000) }] });
  assert.ok(made.result, made.error);
  const big = made.result.created.x;
  const mine = (await call('/api/change', member, { reason: 'test', ops: [{ op: 'create', ref: 'x', type: 'goal', title: 'Kim’s task', visibility: 'shared', body: 'Do it.' }] })).result.created.x;

  const read = async (token: string) => (await call('/api/view', token, { name: 'usage' })).result;
  const seen = await read(member);
  const said = JSON.stringify(seen);
  assert.ok(!said.includes(SECRET) && !said.includes(big), 'the private item is neither named nor pointed at');
  assert.ok(!said.includes('seller.example'), 'where the plan is managed is the admin’s');
  const limit = (answer: any, name: string) => answer.items.find((i: any) => i.id === `use:${name}`);
  const partsOf = (answer: any, name: string) => answer.links.filter((k: any) => k.to === `use:${name}`).map((k: any) => answer.items.find((i: any) => i.id === k.from));
  assert.deepEqual(seen.items.filter((i: any) => i.use.as === 'limit').map((i: any) => i.id), ['use:storage', 'use:requests', 'use:sessions', 'use:looks'], 'members are the admin’s');
  assert.equal(seen.plan, 'Solo');
  const storage = limit(seen, 'storage');
  assert.equal(storage.use.of, 500e6);
  assert.equal(storage.use.of_shown, '500 MB');
  assert.ok(storage.use.used > 0 && storage.use.shown.endsWith('B'));

  // Storage, by what it is made of: the tables, then the types and the largest items, each its share.
  const parts = partsOf(seen, 'storage');
  const tables = parts.filter((p: any) => p.use.as === 'share');
  assert.ok(tables.some((p: any) => p.id === 'use:storage:log_fact'), 'the facts are a part');
  assert.ok(Math.abs(tables.reduce((a: number, p: any) => a + p.use.used, 0) - storage.use.used) < storage.use.used * 0.05, 'the tables add up to what is counted');
  const largest = parts.filter((p: any) => p.use.list === 'Largest items');
  assert.equal(largest[0].id, 'use:storage:hidden', 'the largest item is one the member cannot see: summed, untitled');
  assert.equal(largest[0].title, 'Items you cannot see');
  const own = largest.find((p: any) => p.use.item === mine);
  assert.equal(own?.title, 'Kim’s task', 'what the member can see is named, and opens its page');
  const types = parts.filter((p: any) => p.use.list === 'By type');
  assert.ok(types.some((p: any) => p.title === 'Resource') && types.some((p: any) => p.title === 'Goal'), 'by type, with the types’ names');

  // Requests this minute, by who asked: a person by name, an agent as its person’s agents; never the token.
  await call('/agent/query', agent, { name: 'schema' });
  const now = await read(member);
  const asked = partsOf(now, 'requests').map((p: any) => p.title);
  assert.ok(asked.includes('kim@use.example') || asked.some((t: string) => /kim/i.test(t)), `the member is named: ${asked}`);
  assert.ok(asked.some((t: string) => /agents$/.test(t)), 'their agent is their agents');
  assert.ok(!JSON.stringify(now).includes(agent) && !JSON.stringify(now).includes(member), 'no token');

  // The agent reads the same answer through its own call.
  const its = (await call('/agent/query', agent, { name: 'usage', params: { full: true } })).result;
  assert.deepEqual(its.items.filter((i: any) => i.use.as === 'limit').map((i: any) => i.id), ['use:storage', 'use:requests', 'use:sessions', 'use:looks']);
  assert.ok(!JSON.stringify(its).includes(SECRET));

  // The admin also reads the members and where the plan is managed; their own private item is named for them.
  const theirs = await read(owner);
  assert.equal(theirs.manage, 'https://seller.example/billing');
  assert.deepEqual(partsOf(theirs, 'members').map((p: any) => p.use.item).sort(), [ola, kim].sort());
  assert.equal(limit(theirs, 'members').use.of_shown, '3 members');
  assert.ok(partsOf(theirs, 'storage').some((p: any) => p.use.item === big && p.title === SECRET), 'the owner sees their own item by name');
});

test('the bytes counted as the log is written are what a count made again from the log gives', async () => {
  const { workspaces, call } = await serve('off');
  const ws = await workspaces.get('default');
  const done = await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'goal', title: 'Counted', body: 'Words. '.repeat(200) }, { op: 'create', ref: 'b', type: 'event', title: 'Also' }, { op: 'link', type: 'depends_on', from: 'a', to: 'b' }] });
  assert.ok(done.result, done.error);
  const read = async () => (await ws.pelago.db.query<{ id: string; type: string; bytes: string }>(`select id, type, bytes from item_bytes order by id`)).rows;
  const types = async () => (await ws.pelago.db.query<{ type: string; bytes: string }>(`select type, bytes from type_bytes order by type`)).rows;
  const [kept, keptTypes] = [await read(), await types()];
  assert.ok(kept.some((r) => r.type === 'goal') && kept.some((r) => r.type === 'links'), 'items by type, links as one');
  await ws.pelago.db.transaction((tx) => recountBytes(tx));
  assert.deepEqual(await read(), kept);
  assert.deepEqual(await types(), keptTypes);
});
