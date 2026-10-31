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
  assert.match(checkServerPack({ id: 'x', version: '1', title: 'X', reach: { server: { pages: [{ id: 'hook', file: 'a.html' }] } } }, FIXTURES).join(), /"hook" cannot name/);
  assert.match(checkServerPack({ id: 'x', version: '1', title: 'X' } as never, FIXTURES).join(), /asks for no server reach/);
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

  assert.deepEqual(await post('/x/demo/start', { request: 'r1', email: 'Rosa@Acme.example', name: 'Acme' }), { status: 200, result: { kept: 'r1' } });
  assert.deepEqual((await post('/x/demo/poll', { request: 'r1' })).result, { state: 'waiting' });

  // Only what is signed with the secret the server holds reaches the handler.
  assert.equal((await hook({ request: 'r1' }, 'another secret')).status, 401);
  assert.equal(await workspaces.has('acme'), false);
  assert.deepEqual(await hook({ request: 'r1' }), { status: 200, result: { workspace: 'acme' } });

  const ready = (await post('/x/demo/poll', { request: 'r1' })).result;
  assert.equal(ready.state, 'ready');
  const code = /#\/join\/(inv_acme_[a-f0-9]{40})$/.exec(ready.link)?.[1];
  assert.ok(code, ready.link);
  const { token } = await post('/connect/join', { code });
  const me = await call('/whoami', token, undefined, 'GET');
  assert.deepEqual([me.workspace.id, me.actor.name, me.actor.admin], ['acme', 'rosa@acme.example', true]);
  assert.equal((await post('/connect/join', { code })).status, 410, 'a link works once');

  // A plan's member limit, set by the pack on its own workspace: one more past it is refused, saying how to make room.
  assert.deepEqual((await post('/x/demo/limit', { workspace: 'acme', members: 1, note: 'Move to the larger plan for more.' })).result, { workspace: 'acme', members: 1 });
  assert.match((await call('/api/member_add', token, { email: 'sam@acme.example' })).error, /Acme has room for 1 member\. Move to the larger plan for more\./);
  assert.match((await post('/x/demo/limit', { workspace: 'default', members: 1 })).error, /not a workspace this pack made/);
  assert.match((await post('/x/demo/limit', { workspace: 'acme', members: 0 })).error, /a whole number/);
  const bob = (await call('/api/change', token, { reason: 'test', ops: [{ op: 'create', ref: 'b', type: 'person', title: 'Bob' }] })).result.created.b;
  assert.match((await call('/api/token_create', token, { name: 'bob', kind: 'human', entity: bob })).error, /signs in as a member/, 'no seat by a token');
  assert.match((await post('/x/demo/limit', { workspace: 'acme', members: 1, manage: 'javascript:alert(1)' })).error, /https address/);
  await post('/x/demo/limit', { workspace: 'acme', members: 2, plan: 'Duo', manage: 'https://seller.example/billing' });
  assert.deepEqual((await call('/api/workspace_info', token)).result.member_limit, { members: 2, plan: 'Duo', manage: 'https://seller.example/billing' });
  assert.equal((await call('/api/member_add', token, { email: 'sam@acme.example' })).result.email, 'sam@acme.example');
  assert.match((await call('/api/member_add', token, { email: 'kim@acme.example' })).error, /room for 2 members\.$/);
  // A plan with an end: its days left, and a link to a page on this server saying what it does.
  const until = new Date(Date.now() + 2.5 * 86_400_000).toISOString();
  await post('/x/demo/limit', { workspace: 'acme', members: 2, plan: 'Trial', until, manage: '/x/demo/signup', manage_says: 'Subscribe' });
  assert.deepEqual((await call('/api/workspace_info', token)).result.member_limit, { members: 2, plan: 'Trial', until, manage: '/x/demo/signup', manage_says: 'Subscribe', days_left: 3 });
  assert.match((await post('/x/demo/limit', { workspace: 'acme', members: 2, manage: '//elsewhere.example' })).error, /https address/);
  await post('/x/demo/limit', { workspace: 'acme', members: null });
  assert.equal((await call('/api/member_add', token, { email: 'kim@acme.example' })).result.email, 'kim@acme.example', 'lifted');

  // What a pack keeps under a prefix, in order, as many as it asks for; another prefix's and what ran out are not.
  await post('/x/demo/start', { request: 'r2', email: 'kim@acme.example', name: 'Second' });
  assert.deepEqual((await post('/x/demo/listed', { prefix: 'request:r', most: 1 })).result, [{ key: 'request:r1', value: { email: 'Rosa@Acme.example', name: 'Acme' } }]);
  assert.deepEqual(((await post('/x/demo/listed', { prefix: 'request:' })).result as any[]).map((e) => e.key), ['request:r1', 'request:r2']);
  assert.match((await post('/x/demo/listed', { prefix: '' })).error, /A prefix is/);

  // A new workspace says nothing has been put in it; its admin can rename it, its id staying as it is; the default keeps its name.
  assert.equal((await call('/api/workspace_info', token)).result.started, false);
  assert.ok((await call('/api/workspace_set', token, { name: 'Acme Studio' })).result);
  assert.equal((await call('/whoami', token, undefined, 'GET')).workspace.name, 'Acme Studio');
  assert.deepEqual((await workspaces.list()).find((w) => w.id === 'acme'), { id: 'acme', name: 'Acme Studio' });
  await assert.rejects(workspaces.rename('default', 'Mine'), /keeps its name/);

  // What it did not declare, a workspace it did not make, and the map: refused.
  assert.match((await post('/x/demo/sneak', {})).error, /did not declare the act "mail.send"/);
  assert.match((await post('/x/demo/elsewhere', {})).error, /"default" is not a workspace this pack made/);
  assert.match((await post('/x/demo/peek', {})).error, /reads no map/);
  assert.equal((await post('/x/demo/nothing', {})).status, 404);

  // An ended workspace: read-only, its date on its page, writable again when lifted, and deleted when its day comes.
  const ended = (await post('/x/demo/end', { workspace: 'acme', days: 30, note: 'Pay again.' })).result;
  assert.equal(ended.ended, true);
  const write = () => call('/api/change', token, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'After the end' }] });
  assert.match((await write()).error, /ended on \d{4}-\d{2}-\d{2} and is read-only: it is deleted on \d{4}-\d{2}-\d{2}\. Download its backup on the Workspace page\. Pay again\./);
  assert.match((await call('/api/member_add', token, { email: 'late@acme.example' })).error, /read-only/);
  assert.equal((await call('/api/workspace_info', token)).result.ended.delete_at, ended.delete_at);
  assert.ok((await call('/api/search', token, { q: 'Bob' })).result, 'still readable');
  assert.deepEqual((await post('/x/demo/end', { workspace: 'acme', ended: false })).result, { workspace: 'acme', ended: false });
  assert.ok((await write()).result, 'writable again');

  // Each act is in the owner's history, and the owner sees the packs.
  const owner = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const events = (await call('/api/events', owner, { limit: 20 })).result as any[];
  assert.deepEqual(events.filter((e) => e.action.startsWith('server.')).map((e) => [e.action, e.actor]).reverse(), [
    ['server.workspace.create', 'pack:demo'],
    ['server.workspace.admit', 'pack:demo'],
    ['server.signin.link', 'pack:demo'],
    ['server.workspace.limit', 'pack:demo'],
    ['server.workspace.limit', 'pack:demo'],
    ['server.workspace.limit', 'pack:demo'],
    ['server.workspace.limit', 'pack:demo'],
    ['server.workspace.end', 'pack:demo'],
    ['server.workspace.end', 'pack:demo'],
  ]);
  // The refused delivery is told to the owner, once.
  const notes = (await call('/api/search', owner, { type: 'notification' })).result as any[];
  assert.deepEqual(notes.map((n) => n.title), [`The demo pack's webhook "paid" refused a delivery`]);
  const listed = (await call('/api/server_packs', owner)).result;
  // Those that ship with the kernel (the GitHub App) are listed beside those the configuration names.
  assert.deepEqual(listed.packs.map((p: any) => p.id), ['github_app', 'demo']);
  assert.deepEqual(listed.packs.find((p: any) => p.id === 'demo').acts, ['workspace.create', 'workspace.admit', 'workspace.limit', 'workspace.end', 'signin.link']);
  assert.equal(listed.refused.length, 1);
  assert.match((await call('/api/server_packs', me.actor && token)).error, /default workspace/);

  // Ended with its day come, it is deleted whole: its sign-ins with it.
  await post('/x/demo/end', { workspace: 'acme', days: 1 });
  assert.deepEqual(await workspaces.deleteDue(new Date(Date.now() + 2 * 86_400_000)), ['acme']);
  assert.equal(await workspaces.has('acme'), false);
  assert.deepEqual(await workspaces.deleteDue(new Date(Date.now() + 2 * 86_400_000)), [], 'once');
  assert.match((await call('/whoami', token, undefined, 'GET')).error ?? '', /./);
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
