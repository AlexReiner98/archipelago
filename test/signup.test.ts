import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { freeId, signedByLemon } from '../src/signup.ts';
import { serve } from './serve.ts';

const SECRET = 'a-fake-signing-secret';
const env = { PELAGO_LEMON_CHECKOUT: 'https://example.lemonsqueezy.com/checkout/buy/variant-uuid', PELAGO_LEMON_SECRET: SECRET, PELAGO_SIGNUP_PRICE: '$46 a month' };
before(() => Object.assign(process.env, env));
after(() => {
  for (const key of Object.keys(env)) delete process.env[key];
});

const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex');
const subscription = (event: string, id: string, custom: Record<string, string>, attrs: Record<string, unknown> = {}) =>
  JSON.stringify({ meta: { event_name: event, custom_data: custom }, data: { type: 'subscriptions', id, attributes: { status: 'on_trial', user_email: 'Mani@Aaline.example', trial_ends_at: '2026-10-27T00:00:00Z', ...attrs } } });

test('a workspace is bought: the checkout is paid, the workspace is made once, and the browser that began it is signed in once', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const deliver = (body: string, signature = sign(body)) => fetch(`${base}/connect/lemon`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': signature }, body }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const poll = (request: string, secret: string) => call(`/connect/signup/${request}`, secret);

  assert.deepEqual(await (await fetch(`${base}/connect/signup`)).json(), { open: true, price: '$46 a month' });
  assert.match((await call('/connect/signup', undefined, { name: 'Aaline', email: 'not an address' })).error, /not an email/);
  const begun = await call('/connect/signup', undefined, { name: 'Aaline Studio', email: 'mani@aaline.example' });
  const checkout = new URL(begun.checkout);
  assert.equal(checkout.origin + checkout.pathname, env.PELAGO_LEMON_CHECKOUT);
  assert.deepEqual([checkout.searchParams.get('checkout[email]'), checkout.searchParams.get('checkout[custom][signup]'), checkout.searchParams.get('checkout[custom][name]')], ['mani@aaline.example', begun.request, 'Aaline Studio']);
  assert.equal((await poll(begun.request, begun.secret)).state, 'waiting');
  assert.equal((await poll(begun.request, 'wrong')).status, 410, 'only the browser holding the secret');

  // Only what Lemon Squeezy signed is believed.
  const made = subscription('subscription_created', '1001', { signup: begun.request, name: 'Aaline Studio' });
  assert.equal((await deliver(made, 'f'.repeat(64))).status, 401);
  assert.equal((await deliver(made, sign(made, 'another secret'))).status, 401);
  assert.equal((await workspaces.has('aaline-studio')), false);

  assert.deepEqual(await deliver(made), { status: 200, done: 'made', workspace: 'aaline-studio' });
  assert.deepEqual(await deliver(made), { status: 200, done: 'already made', workspace: 'aaline-studio' }, 'a repeated delivery makes nothing');

  const ready = await poll(begun.request, begun.secret);
  assert.equal(ready.state, 'ready');
  assert.deepEqual(ready.workspace, { id: 'aaline-studio', name: 'Aaline Studio' });
  assert.equal((await poll(begun.request, begun.secret)).status, 410, 'signed in once');
  const me = await call('/whoami', ready.token, undefined, 'GET');
  assert.deepEqual([me.workspace.id, me.actor.kind, me.actor.admin], ['aaline-studio', 'human', true]);
  const members = (await call('/api/member_list', ready.token)).result;
  assert.deepEqual(members.map((m: any) => [m.email, m.admin]), [['mani@aaline.example', true]]);

  // The same name again is another workspace; a delivery whose request ran out still makes it, from what it carries.
  const again = subscription('subscription_created', '1002', { signup: 'su_nothing1', name: 'Aaline Studio' }, { user_email: 'other@example.com' });
  assert.deepEqual(await deliver(again), { status: 200, done: 'made', workspace: 'aaline-studio-2' });

  // What happens to the subscription afterwards is kept and told to the owner; nothing is done to the workspace.
  const owner = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  assert.equal((await deliver(subscription('subscription_cancelled', '1001', {}, { status: 'cancelled', ends_at: '2026-11-27T00:00:00Z' }))).done, 'cancelled');
  const told = (await call('/api/view', owner, { name: 'notifications' })).result.map((n: any) => n.title);
  assert.ok(told.includes('"Aaline Studio" was bought'), told.join(' | '));
  assert.ok(told.includes('The subscription for "aaline-studio" is cancelled'), told.join(' | '));
  assert.equal((await call('/whoami', ready.token, undefined, 'GET')).workspace.id, 'aaline-studio', 'still signed in');
  assert.equal((await deliver(subscription('subscription_updated', '9999', {}))).done, 'unknown subscription');
  assert.equal((await deliver(JSON.stringify({ meta: { event_name: 'order_created' }, data: { type: 'orders', id: '1' } }))).done, 'ignored');
});

test('without the checkout and its secret, nothing is sold', async () => {
  const { call } = await serve('tokens');
  const was = process.env.PELAGO_LEMON_SECRET;
  delete process.env.PELAGO_LEMON_SECRET;
  try {
    assert.equal((await call('/connect/signup', undefined, undefined, 'GET')).open, false);
    assert.match((await call('/connect/signup', undefined, { name: 'X', email: 'x@example.com' })).error, /does not sell/);
    assert.equal(signedByLemon(Buffer.from('{}'), sign('{}')), false, 'no secret, no delivery believed');
  } finally {
    process.env.PELAGO_LEMON_SECRET = was;
  }
});

test('a workspace id is made from its name', async () => {
  const taken = new Set(['acme', 'default']);
  const at = { has: async (id: string) => taken.has(id) };
  assert.equal(await freeId(at, 'Acme'), 'acme-2');
  assert.equal(await freeId(at, 'Café Ünïon & Co.'), 'cafe-union-co');
  assert.equal(await freeId(at, 'Default'), 'default-2');
  assert.equal(await freeId(at, '!!!'), 'workspace');
});
