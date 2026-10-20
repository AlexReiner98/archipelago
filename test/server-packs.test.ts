import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { freeId } from '../src/server-acts.ts';
import { checkServerPack, loadServerPacks } from '../src/server-packs.ts';
import { signedBy } from '../src/server-routes.ts';
import { serve } from './serve.ts';

const FIXTURES = join(import.meta.dirname, 'server-packs');
const SECRET = 'a-fake-signing-secret';
before(() => Object.assign(process.env, { PELAGO_SERVER_PACKS: FIXTURES, PELAGO_SECRET_DEMO_HOOK: SECRET }));
after(() => {
  delete process.env.PELAGO_SERVER_PACKS;
  delete process.env.PELAGO_SECRET_DEMO_HOOK;
});

test('server packs are loaded from the folders the configuration names; one that asks for what is not an act is left out', () => {
  const { packs, refused } = loadServerPacks([FIXTURES]);
  assert.deepEqual(packs.map((p) => p.file.id), ['demo']);
  assert.equal(refused.length, 1);
  assert.match(refused[0].why.join(), /"database.drop" is not a server act/);
  assert.deepEqual(loadServerPacks([join(FIXTURES, 'nowhere')]).refused[0].why, ['there is no such folder']);
  assert.match(checkServerPack({ id: 'x', version: '1', title: 'X', tier: 'server', pages: [{ id: 'hook', file: 'a.html' }] }, FIXTURES).join(), /"hook" cannot name/);
  assert.match(checkServerPack({ id: 'x', version: '1', title: 'X' } as never, FIXTURES).join(), /not marked tier "server"/);
});

test('a server pack sells a workspace: its page, its entries, a signed webhook, and the buyer signed in by a one-time link', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const hook = (body: unknown, secret = SECRET) => {
    const raw = JSON.stringify(body);
    return fetch(`${base}/x/demo/hook/paid`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', secret).update(raw).digest('hex') }, body: raw }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  };

  // Its page, under a strict policy, and the script it loads; nothing else from its folder.
  const page = await fetch(`${base}/x/demo/signup`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'; script-src 'self'/);
  assert.match(await page.text(), /\/x\/demo\/public\/signup\.js/);
  assert.equal((await fetch(`${base}/x/demo/public/signup.js`)).headers.get('content-type'), 'text/javascript');
  for (const path of ['/x/demo/public/signup.html', '/x/demo/handler.js', '/x/demo/public/..%2Fhandler.js', '/x/nobody/signup', '/x/demo/signup/more']) assert.equal((await fetch(base + path)).status, 404, path);

  assert.deepEqual(await post('/x/demo/start', { request: 'r1', email: 'Mani@Aaline.example', name: 'Aaline' }), { status: 200, result: { kept: 'r1' } });
  assert.deepEqual((await post('/x/demo/poll', { request: 'r1' })).result, { state: 'waiting' });

  // Only what is signed with the secret the server holds reaches the handler.
  assert.equal((await hook({ request: 'r1' }, 'another secret')).status, 401);
  assert.equal(await workspaces.has('aaline'), false);
  assert.deepEqual(await hook({ request: 'r1' }), { status: 200, result: { workspace: 'aaline' } });

  const ready = (await post('/x/demo/poll', { request: 'r1' })).result;
  assert.equal(ready.state, 'ready');
  const code = /#\/join\/(inv_aaline_[a-f0-9]{40})$/.exec(ready.link)?.[1];
  assert.ok(code, ready.link);
  const { token } = await post('/connect/join', { code });
  const me = await call('/whoami', token, undefined, 'GET');
  assert.deepEqual([me.workspace.id, me.actor.name, me.actor.admin], ['aaline', 'mani@aaline.example', true]);
  assert.equal((await post('/connect/join', { code })).status, 410, 'a link works once');

  // What it did not declare, a workspace it did not make, and the map: refused.
  assert.match((await post('/x/demo/sneak', {})).error, /did not declare the act "mail.send"/);
  assert.match((await post('/x/demo/elsewhere', {})).error, /"default" is not a workspace this pack made/);
  assert.match((await post('/x/demo/peek', {})).error, /reads no map/);
  assert.equal((await post('/x/demo/nothing', {})).status, 404);

  // Each act is in the owner's history, and the owner sees the packs.
  const owner = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const events = (await call('/api/events', owner, { limit: 20 })).result as any[];
  assert.deepEqual(events.filter((e) => e.action.startsWith('server.')).map((e) => [e.action, e.actor]).reverse(), [
    ['server.workspace.create', 'pack:demo'],
    ['server.workspace.admit', 'pack:demo'],
    ['server.signin.link', 'pack:demo'],
  ]);
  const listed = (await call('/api/server_packs', owner)).result;
  assert.deepEqual(listed.packs.map((p: any) => [p.id, p.acts]), [['demo', ['workspace.create', 'workspace.admit', 'signin.link']]]);
  assert.equal(listed.refused.length, 1);
  assert.match((await call('/api/server_packs', me.actor && token)).error, /default workspace/);
});

test('a webhook signature is the HMAC of the raw body, prefixed or bare', () => {
  const raw = Buffer.from('{"a":1}');
  const hex = createHmac('sha256', 's').update(raw).digest('hex');
  assert.equal(signedBy('s', raw, `sha256=${hex}`), true);
  assert.equal(signedBy('s', raw, hex, 'hex'), true);
  assert.equal(signedBy('s', raw, hex), false);
  assert.equal(signedBy('t', raw, hex, 'hex'), false);
  assert.equal(signedBy('s', raw, undefined, 'hex'), false);
});

test('a workspace id is made from its name', async () => {
  const taken = new Set(['acme']);
  const at = { has: async (id: string) => taken.has(id) };
  assert.equal(await freeId(at, 'Acme'), 'acme-2');
  assert.equal(await freeId(at, 'Café Ünïon & Co.'), 'cafe-union-co');
  assert.equal(await freeId(at, 'Default'), 'default-2');
  assert.equal(await freeId(at, '!!!'), 'workspace');
});
