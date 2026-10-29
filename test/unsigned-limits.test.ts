// What anyone may ask with no token cannot use up every tenant (the audit of 29 Oct 2026): an IPv6 caller is one
// caller across its /64, signing in has a budget of its own, a token nobody made opens no workspace, and a published
// page's live streams are capped by address and by document.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counted, limiter } from '../src/limit.ts';
import { listen as listenTo, LIVE_EACH } from '../src/published-live.ts';
import { serve } from './serve.ts';

test('an IPv6 address is counted by its /64, written any way', () => {
  assert.equal(counted('2001:db8:1:2::1'), counted('2001:0db8:0001:0002:ffff:eeee:dddd:cccc'));
  assert.notEqual(counted('2001:db8:1:2::1'), counted('2001:db8:1:3::1'));
  assert.equal(counted('::1'), '0:0:0:0::/64');
  assert.equal(counted('198.51.100.7'), '198.51.100.7');
  assert.equal(counted('::ffff:198.51.100.7'), '::ffff:198.51.100.7');
  const count = limiter({ each: 2 });
  assert.deepEqual([count.take('2001:db8::1'), count.take('2001:db8::2'), count.take('2001:db8::ffff:3') > 0], [0, 0, true], 'a /64 is one caller');
});

test('pages asked too often from everywhere leave signing in open, and the other way round', async () => {
  const { base } = await serve('tokens', { open: { each: 50, all: 3 }, signIn: { each: 2, all: 4 } });
  const from = (address: string) => ({ 'content-type': 'application/json', 'x-forwarded-for': address });
  const page = async (address: string) => (await fetch(base + '/connect/setup.mjs', { headers: from(address) })).status;
  const signIn = async (address: string, email = 'a@example.com') => (await fetch(base + '/connect/sign-in', { method: 'POST', headers: from(address), body: JSON.stringify({ email }) })).status;
  assert.deepEqual([await page('198.51.100.1'), await page('198.51.100.2'), await page('198.51.100.3'), await page('198.51.100.4')], [200, 200, 200, 429], 'the pages are full');
  assert.equal(await signIn('198.51.100.9'), 200, 'and signing in is not');
  // From one /64 claiming a new address each time, signing in stops at its own count; another caller still signs in.
  assert.deepEqual([await signIn('2001:db8:5:6::1'), await signIn('2001:db8:5:6::2'), await signIn('2001:db8:5:6::3')], [200, 200, 429]);
  assert.equal(await signIn('198.51.100.8'), 200);
});

test('a buyer’s page polling for its workspace is counted with the pages, not against signing in', async () => {
  const { base } = await serve('tokens', { signIn: { each: 2 } });
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.40' };
  for (let i = 0; i < 3; i++) await fetch(base + '/connect/signup/su_abcdefgh', { method: 'POST', headers });
  assert.equal((await fetch(base + '/connect/sign-in', { method: 'POST', headers, body: JSON.stringify({ email: 'b@example.com' }) })).status, 200);
});

test('a token nobody made is refused before its workspace is opened', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const acme = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme' })).result.owner_token as string;
  assert.equal((await call('/agent/search', acme, {})).status, 200, 'a token made for it is good');
  await workspaces.closeIdle(0);
  const opened: string[] = [];
  const get = workspaces.get.bind(workspaces);
  workspaces.get = (id) => (opened.push(id), get(id));
  for (let i = 0; i < 3; i++) assert.equal((await call('/agent/search', `pel_acme_${String(i).repeat(40)}`, {})).status, 401);
  assert.deepEqual(opened.filter((id) => id === 'acme'), [], 'no wrong token opened it');
  assert.equal((await call('/agent/search', acme, {})).status, 200);
});

test('a published page’s live streams are capped from one address', async () => {
  const { call, base } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'd', type: 'document', title: 'Live', visibility: 'shared', body: 'Words.' }] })).result.created.d;
  await call('/api/publish', undefined, { id: made });
  const streams: AbortController[] = [];
  // Each answer is held, not only its status: fetch closes a stream nobody holds once it is collected, and the
  // server rightly gives its place back, which is not what is being tried here.
  const held: Response[] = [];
  const listen = async (address: string) => {
    const ac = new AbortController();
    streams.push(ac);
    const res = await fetch(`${base}/p/default/${made}/live`, { headers: { 'x-forwarded-for': address }, signal: ac.signal });
    held.push(res);
    return res.status;
  };
  const statuses: number[] = [];
  for (let i = 0; i <= LIVE_EACH; i++) statuses.push(await listen(`2001:db8:9:9::${i + 1}`));
  assert.deepEqual(statuses, [...Array(LIVE_EACH).fill(200), 429], 'one /64 holds at most so many streams');
  assert.equal(await listen('198.51.100.5'), 200, 'another address still listens');
  for (const ac of streams) ac.abort();
  await new Promise((r) => setTimeout(r, 200));
  // A page that left before its stream began is not counted: else opening and resetting at once would use the address up.
  for (let i = 0; i < LIVE_EACH + 2; i++) listenTo({ destroyed: true } as never, 'default', made, {}, '203.0.113.50');
  assert.equal(await listen('203.0.113.50'), 200);
  assert.equal(await listen('2001:db8:9:9::1'), 200, 'a stream closed is given back');
  for (const ac of streams) ac.abort();
});

test('a backup link is counted as the open routes are: guessed keys cannot keep a workspace open', async () => {
  const { base } = await serve('tokens', { open: { each: 2 } });
  const get = async () => (await fetch(`${base}/backup-file/default/${'0'.repeat(32)}`, { headers: { 'x-forwarded-for': '198.51.100.30' } })).status;
  assert.deepEqual([await get(), await get(), await get()], [404, 404, 429]);
});

test('a pack sends a person back only to an address on this server', async () => {
  const { onThisServer } = await import('../src/server-routes.ts');
  assert.equal(onThisServer('/#/workspace'), '/#/workspace');
  for (const away of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', 'https://evil.example', 'javascript:alert(1)']) assert.equal(onThisServer(away), '/', JSON.stringify(away));
});
