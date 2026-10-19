// A running system asks for its token, and a person approves or refuses: the request needs no token, the answer is a
// person's alone, the token is within the item watched at the address the system named and may only report, and it is
// handed to the system's poll once. A request that is not answered runs out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { serve } from './serve.ts';

async function setUp() {
  const { workspaces, call, base } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const owner = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const made = await call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', ref: 'app', type: 'software.component', title: 'App', status: 'up', visibility: 'shared', props: { url: 'https://app.example.com/health' } }] });
  const app = made.result.created.app as string;
  const ask = (body: unknown) => call('/connect/request', undefined, body);
  const poll = (asked: { poll: { url: string; secret: string } }, secret = asked.poll.secret) => call(new URL(asked.poll.url).pathname, secret);
  return { workspaces, db, call, base, owner, app, ask, poll };
}

test('a request needs no token, shows a code, and waits for a person', async () => {
  const { call, owner, app, ask, poll } = await setUp();
  const asked = await ask({ name: 'deploy', address: 'HTTPS://app.example.com/health/', may: 'report' });
  assert.equal(asked.status, 200);
  assert.match(asked.code, /^[B-Z]{4}-[B-Z]{4}$/);
  assert.match(asked.poll.url, /\/connect\/poll\/default\/a_[0-9a-f]{12}$/);
  assert.ok(Date.parse(asked.expires_at) - Date.now() > 9 * 60_000);
  assert.deepEqual((await poll(asked)).state, 'pending');

  // The person sees it on the item's page, by the address it named, and nothing of its secret.
  const listed = (await call('/api/token_requests', owner, { within: app })).result as any[];
  assert.deepEqual(listed.map((a) => [a.name, a.code, a.items[0]?.id]), [['deploy', asked.code, app]]);
  assert.ok(!JSON.stringify(listed).includes(asked.poll.secret) && !('poll_hash' in listed[0]));

  // Only for humans: a token, even one that may change, cannot answer it.
  const agent = (await call('/api/token_create', owner, { kind: 'agent', name: 'claude' })).result.token;
  assert.match((await call('/api/token_request_answer', agent, { id: listed[0].id, approve: true })).error, /humans only/);
  assert.match((await call('/api/token_requests', agent, {})).error, /humans only/);

  // It asks for no more than reporting, and names itself and an address.
  assert.equal((await ask({ name: 'deploy', address: 'https://app.example.com/health', may: 'change' })).status, 400);
  assert.equal((await ask({ address: 'https://app.example.com/health' })).status, 400);
  assert.equal((await ask({ name: 'deploy', address: 'x', workspace: 'nowhere' })).status, 404);
  // Never from a web page.
  const fromPage = await fetch(new URL('/connect/request', asked.poll.url), { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ name: 'x', address: 'https://app.example.com/health' }) });
  assert.equal(fromPage.status, 403);
});

test('approved, the token is handed to the poll once, within the item, and may only report', async () => {
  const { call, owner, app, ask, poll } = await setUp();
  const asked = await ask({ name: 'deploy', address: 'https://app.example.com/health' });
  const [request] = (await call('/api/token_requests', owner, {})).result as any[];
  const approved = await call('/api/token_request_answer', owner, { id: request.id, approve: true });
  assert.deepEqual([approved.result.within.map((e: any) => e.id), approved.result.may], [[app], 'report']);
  assert.match((await call('/api/token_request_answer', owner, { id: request.id, approve: false })).error, /no longer waiting/);

  // Without the poll's secret there is nothing to collect.
  const wrong = await poll(asked, '0'.repeat(48));
  assert.deepEqual([wrong.status, wrong.state, wrong.token], [410, 'gone', undefined]);

  const handed = await poll(asked);
  assert.equal(handed.state, 'approved');
  assert.match(handed.token, /^pel_default_[0-9a-f]{40}$/);
  const again = await poll(asked);
  assert.deepEqual([again.status, again.state, again.token], [410, 'gone', undefined], 'handed once');

  const [token] = ((await call('/api/token_list', owner, { within: app })).result as any[]).filter((t) => t.name === 'deploy');
  assert.deepEqual([token.kind, token.within, token.may], ['agent', [app], 'report']);
  assert.equal(((await call('/api/token_requests', owner, {})).result as any[]).length, 0, 'answered, it leaves the card');

  // The token reports, and does nothing else.
  const reported = await call('/agent/report', handed.token, { live: { at: 'https://app.example.com/health', commit: 'abc1234' } });
  assert.equal(reported.status, 200);
  assert.match((await call('/agent/search', handed.token, { q: 'App' })).error, /may only report/);
});

test('refused, the poll is told so and no token is made; unanswered, the request runs out', async () => {
  const { db, call, owner, ask, poll } = await setUp();
  const refused = await ask({ name: 'stranger', address: 'https://app.example.com/health' });
  const id = ((await call('/api/token_requests', owner, {})).result as any[])[0].id;
  assert.equal((await call('/api/token_request_answer', owner, { id, approve: false })).result.refused, id);
  assert.equal((await poll(refused)).state, 'refused');
  assert.equal(((await call('/api/token_list', owner, {})).result as any[]).filter((t) => t.name === 'stranger').length, 0);

  // A request about no item can be seen and refused, but not approved.
  await ask({ name: 'typo', address: 'https://app.example.com/healht' });
  const typo = ((await call('/api/token_requests', owner, {})).result as any[]).find((a) => a.name === 'typo');
  assert.deepEqual(typo.items, [null]);
  assert.match((await call('/api/token_request_answer', owner, { id: typo.id, approve: true })).error, /No item you can see is watched/);

  const late = await ask({ name: 'late', address: 'https://app.example.com/health' });
  await db.query(`update transient set until = now() - interval '1 minute' where value->>'name' = 'late'`);
  assert.deepEqual([(await poll(late)).status, (await poll(late)).state], [410, 'gone']);
  assert.ok(!((await call('/api/token_requests', owner, {})).result as any[]).some((a) => a.name === 'late'));
});

test('without tokens there is nothing to ask for', async () => {
  const { call } = await serve('off');
  assert.equal((await call('/connect/request', undefined, { name: 'deploy', address: 'https://app.example.com/health' })).status, 404);
  assert.equal((await call('/connect/setup.mjs', undefined, undefined, 'GET')).status, 200, 'the setup script is still given');
});

test('a deploy names both colours, and its token is within both', async () => {
  const { call, owner, ask, poll } = await setUp();
  const made = await call('/api/change', owner, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'blue', type: 'software.component', title: 'App, blue', status: 'up', visibility: 'shared', props: { url: 'http://app-blue:3100/health' } },
      { op: 'create', ref: 'green', type: 'software.component', title: 'App, green', status: 'planned', visibility: 'shared', props: { url: 'http://app-green:3100/health' } },
    ],
  });
  const { blue, green } = made.result.created;
  const asked = await ask({ name: 'deploy', addresses: ['http://app-blue:3100/health', 'http://app-green:3100/health'], may: 'report' });
  const [request] = (await call('/api/token_requests', owner, { within: green })).result as any[];
  assert.deepEqual(request.items.map((i: any) => i.id), [blue, green]);
  await call('/api/token_request_answer', owner, { id: request.id, approve: true });
  const handed = await poll(asked);
  const reported = await call('/agent/report', handed.token, { live: { at: 'http://app-green:3100/health', commit: 'abc1234' }, idle: ['http://app-blue:3100/health'] });
  assert.deepEqual(reported.result.changed.map((c: any) => [c.title, c.to]).sort(), [['App, blue', 'planned'], ['App, green', 'up']]);
});
