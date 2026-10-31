// A client that signs in through the browser (src/oauth.ts). The first test is the whole path as a client walks it, by
// the MCP SDK's own OAuth client and nothing of ours; the rest are what must be refused.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createToken, listTokens, rotateGrant, grantToken } from '../src/auth.ts';
import { clientOf, goodRedirect, listedRedirect, registerClient, returnsTo } from '../src/oauth-clients.ts';
import { serve } from './serve.ts';

const CALLBACK = 'http://localhost:4567/callback';

async function signedIn() {
  const server = await serve('tokens');
  const pelago = (await server.workspaces.get('default')).pelago;
  await pelago.init({ kind: 'human', name: 'alex' }, { name: 'Alex' });
  const me = await pelago.setting<string>('me');
  const owner = (await createToken(pelago.db, 'default', { kind: 'human', name: 'alex', admin: true, entity: me })).token;
  return { ...server, db: pelago.db, owner, me };
}

/** What the page does with an authorize address: follow it to the page, then say Allow as this person. */
async function browser(base: string, at: URL, person: string, allow = true) {
  const opened = await fetch(at, { redirect: 'manual' });
  assert.equal(opened.status, 302, 'the address leads to the page');
  const location = opened.headers.get('location')!;
  assert.match(location, /^\/#\/authorize\?/);
  const query = location.split('?').slice(1).join('?');
  const post = (path: string, body: unknown, token?: string) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
  const described = await (await post('/oauth/describe', { query })).json();
  const answered = await post('/oauth/allow', { query, allow }, person);
  return { described, status: answered.status, body: await answered.json(), query, post };
}

/** A client as the SDK makes one: all it is told is the address. */
function sdkClient(base: string, name: string) {
  const held: { client?: unknown; tokens?: any; verifier?: string; opened?: URL } = {};
  const provider: OAuthClientProvider = {
    redirectUrl: CALLBACK,
    clientMetadata: { client_name: name, redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
    clientInformation: () => held.client as never,
    saveClientInformation: (c) => void (held.client = c),
    tokens: () => held.tokens,
    saveTokens: (t) => void (held.tokens = t),
    redirectToAuthorization: (url) => void (held.opened = url),
    saveCodeVerifier: (v) => void (held.verifier = v),
    codeVerifier: () => held.verifier!,
  };
  const transport = () => new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider });
  return { held, transport };
}

test('a client told only the address signs in through the browser and calls the map', async () => {
  const { base, owner, db, call } = await signedIn();
  const client = sdkClient(base, 'Some client');
  const first = client.transport();
  const mcp = new McpClient({ name: 'test', version: '1' });
  await assert.rejects(mcp.connect(first), 'it is sent to sign in first');
  assert.ok(client.held.opened, 'the client found where to send the person, from the 401 alone');

  const said = await browser(base, client.held.opened!, owner);
  assert.deepEqual(said.described, { client: 'Some client', returns_to: 'this computer' });
  assert.equal(said.status, 200);
  const back = new URL(said.body.redirect);
  assert.equal(back.searchParams.get('iss'), base, 'it says who answered');
  await first.finishAuth(back.searchParams.get('code')!);

  const connected = new McpClient({ name: 'test', version: '1' });
  await connected.connect(client.transport());
  const names = (await connected.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('query') && names.includes('change'), 'it has the agents’ tools');
  const made = await connected.callTool({ name: 'change', arguments: { reason: 'first', ops: [{ op: 'create', type: 'note', title: 'From a browser sign-in' }] } });
  assert.match(JSON.stringify(made.content), /applied|proposed/);
  await connected.close();

  const row = (await listTokens(db)).find((t) => t.client);
  assert.ok(row);
  assert.deepEqual([row.kind, row.name, row.admin], ['agent', 'Some client', false], 'an agent’s token, acting for whoever said Allow');
  const events = (await call('/api/events', owner, { limit: 20 })).result as any[];
  assert.ok(events.some((e) => String(e.actor).startsWith('agent:Some client')), 'the log names the client');
});

test('/mcp says where to look, and only /mcp; the documents say the same', async () => {
  const { base } = await signedIn();
  const asked = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(asked.status, 401);
  const pointer = /resource_metadata="([^"]+)"/.exec(asked.headers.get('www-authenticate') ?? '')?.[1];
  assert.ok(pointer);
  const api = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(api.headers.get('www-authenticate'), null);
  const resource = await (await fetch(pointer)).json();
  assert.equal(resource.resource, `${base}/mcp`);
  assert.deepEqual(resource.authorization_servers, [base]);
  assert.equal((await fetch(`${base}/.well-known/oauth-protected-resource`)).status, 200, 'and at the root');
  const server = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.equal(server.issuer, base);
  assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
  assert.ok(server.token_endpoint_auth_methods_supported.includes('none'), 'Claude’s published client needs this to use its document');
  assert.equal(server.client_id_metadata_document_supported, true);
  assert.ok(server.scopes_supported.includes('offline_access'));
  assert.ok(!resource.scopes_supported.includes('offline_access'), 'the specification keeps it off the resource');
});

test('a client with no token is not counted against the address it shares, on /mcp alone', async () => {
  const { base } = await serve('tokens', { refused: { each: 2 } });
  const post = (path: string, token?: string) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: '{}' });
  for (let i = 0; i < 5; i++) assert.equal((await post('/mcp')).status, 401);
  assert.equal((await post('/mcp', `pel_default_${'0'.repeat(40)}`)).status, 401);
  assert.equal((await post('/mcp', `pel_default_${'1'.repeat(40)}`)).status, 401);
  assert.equal((await post('/mcp')).status, 429, 'a wrong token is counted, there as anywhere');
});

test('with auth off there is nothing to sign in to', async () => {
  const { base } = await serve('off');
  assert.equal((await fetch(`${base}/.well-known/oauth-authorization-server`)).status, 404);
});

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const form = (base: string, fields: Record<string, string>) => fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });

async function asked(base: string, redirect = CALLBACK) {
  const { client_id } = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect] }) })).json();
  const { verifier, challenge } = pkce();
  const url = new URL(`${base}/oauth/authorize`);
  for (const [k, v] of Object.entries({ response_type: 'code', client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'abc', resource: `${base}/mcp` })) url.searchParams.set(k, v);
  return { url, client_id, verifier };
}

test('a code goes once, to the client it was for, with the verifier it began with', async () => {
  const { base, owner } = await signedIn();
  const { url, client_id, verifier } = await asked(base);
  const code = async () => new URL((await browser(base, url, owner)).body.redirect).searchParams.get('code')!;
  const fields = (c: string, over = {}) => ({ grant_type: 'authorization_code', code: c, client_id, redirect_uri: CALLBACK, code_verifier: verifier, ...over });
  assert.equal((await (await form(base, fields(await code(), { code_verifier: 'x'.repeat(43) }))).json()).error, 'invalid_grant', 'the wrong verifier');
  assert.equal((await (await form(base, fields(await code(), { client_id: 'cl_e30' }))).json()).error, 'invalid_grant', 'another client');
  assert.equal((await (await form(base, fields(await code(), { redirect_uri: 'https://evil.example/cb' }))).json()).error, 'invalid_grant', 'another redirect');
  const good = await code();
  const taken = await (await form(base, fields(good))).json();
  assert.match(taken.access_token, /^pel_default_/);
  assert.equal(taken.expires_in, 3600);
  assert.equal((await (await form(base, fields(good))).json()).error, 'invalid_grant', 'a second time');
  assert.equal((await form(base, fields(await code(), { resource: 'https://other.example/mcp' }))).status, 400, 'for another resource');
});

test('only a signed-in person says Allow, and Deny makes nothing', async () => {
  const { base, owner, call, db } = await signedIn();
  const { url } = await asked(base);
  const agent = (await call('/api/token_create', owner, { kind: 'agent', name: 'a' })).result.token as string;
  assert.equal((await browser(base, url, agent)).status, 403, 'an agent cannot allow one for a person');
  assert.equal((await browser(base, url, 'pel_default_' + '0'.repeat(40))).status, 401, 'nor can a bad sign-in');
  const denied = new URL((await browser(base, url, owner, false)).body.redirect);
  assert.equal(denied.searchParams.get('error'), 'access_denied');
  assert.equal(denied.searchParams.get('state'), 'abc');
  assert.equal(denied.searchParams.get('code'), null);
  assert.equal((await listTokens(db)).filter((t) => t.client).length, 0);
});

test('a client that lies about where it returns is never sent there', async () => {
  const { base } = await signedIn();
  const { url } = await asked(base);
  url.searchParams.set('redirect_uri', 'https://evil.example/cb');
  const res = await fetch(url, { redirect: 'manual' });
  assert.equal(res.status, 400, 'a bad redirect is said to the person, not followed');
  const { url: plain } = await asked(base);
  plain.searchParams.delete('code_challenge');
  const told = await fetch(plain, { redirect: 'manual' });
  assert.match(told.headers.get('location')!, /^http:\/\/localhost:4567\/callback\?.*error=invalid_request/, 'no PKCE is told to the client');
});

test('a refresh rotates in one row; a replay ends the connection; a revoke ends the refresh', async () => {
  const { base, db, call, owner, me } = await signedIn();
  const first = await grantToken(db, 'default', { name: 'Claude', entity: me, client: 'cl_x' });
  assert.equal((await call('/agent/query', first.access, { name: 'search', params: { q: 'x' } })).status, 200, 'the access token works');
  assert.equal(await rotateGrant(db, 'default', first.refresh, 'cl_other'), undefined, 'another client’s');
  const second = (await rotateGrant(db, 'default', first.refresh, 'cl_x'))!;
  assert.ok(second);
  assert.equal((await listTokens(db)).filter((t) => t.client).length, 1, 'one connection, one row');
  assert.equal((await call('/agent/query', first.access, { name: 'search', params: { q: 'x' } })).status, 401, 'the old access token ends');
  assert.equal((await call('/agent/query', second.access, { name: 'search', params: { q: 'x' } })).status, 200, 'the new one works');
  assert.equal(await rotateGrant(db, 'default', first.refresh), undefined, 'a replay at once is refused');
  assert.equal((await listTokens(db)).find((t) => t.client)!.revoked_at, null, 'and forgiven: the answer may have been lost');
  await db.query(`update token set granted = jsonb_set(granted, '{rotated}', '"2020-01-01T00:00:00.000Z"') where granted is not null`);
  assert.equal(await rotateGrant(db, 'default', first.refresh), undefined);
  assert.ok((await listTokens(db)).find((t) => t.client)!.revoked_at, 'a replay later ends the connection');
  assert.equal(await rotateGrant(db, 'default', second.refresh), undefined, 'and what it held ends with it');

  const third = await grantToken(db, 'default', { name: 'Claude', entity: me, client: 'cl_x' });
  const id = (await listTokens(db)).find((t) => t.client && !t.revoked_at)!.id;
  await call('/api/token_revoke', owner, { id });
  assert.equal(await rotateGrant(db, 'default', third.refresh), undefined, 'Revoke on the Agents screen ends the refresh too');
});

test('a browser-connected token raises no new-place warning', async () => {
  const { db, me, workspaces } = await signedIn();
  const { verifyToken } = await import('../src/auth.ts');
  const made = await grantToken(db, 'default', { name: 'Claude', entity: me, client: 'cl_x' });
  const pasted = (await createToken(db, 'default', { kind: 'agent', name: 'p', entity: me })).token;
  const pelago = (await workspaces.get('default')).pelago;
  await verifyToken(pelago.db as never, made.access, '160.79.104.1');
  await verifyToken(pelago.db as never, pasted, '160.79.104.1');
  assert.equal((await verifyToken(pelago.db as never, made.access, '160.79.105.1'))?.newPlace, undefined);
  assert.equal((await verifyToken(pelago.db as never, pasted, '160.79.105.1'))?.newPlace, '160.79.105.x');
});

test('the redirects clients use are taken, and what a browser would run is not', () => {
  for (const good of ['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect', 'http://localhost:3118/callback', 'http://127.0.0.1:53280/callback', 'http://[::1]:9/cb', 'cursor://anysphere.cursor-mcp/oauth/callback', 'vscode://publisher/cb']) assert.ok(goodRedirect(good), good);
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'http://evil.example/cb', 'https://a.example/cb#frag', 'https://u:p@a.example/', 'not a url', 42]) assert.ok(!goodRedirect(bad), String(bad));
  const client = { id: 'x', name: 'n', redirects: ['http://localhost/callback', 'https://a.example/cb'] };
  assert.ok(listedRedirect(client, 'http://localhost:3118/callback'), 'a native client picks its port as it runs');
  assert.ok(!listedRedirect(client, 'http://localhost:3118/other'));
  assert.ok(!listedRedirect(client, 'https://a.example/cb2'), 'exactly, otherwise');
  assert.equal(returnsTo('https://claude.ai/x'), 'claude.ai');
  assert.equal(returnsTo('http://127.0.0.1:1/x'), 'this computer');
  assert.equal(returnsTo('cursor://x/y'), 'the cursor app');
});

test('registering keeps nothing, and the id holds what was said', async () => {
  const given = registerClient({ client_name: 'A\u0000 name', redirect_uris: ['https://a.example/cb'] });
  assert.equal(given.token_endpoint_auth_method, 'none');
  const client = await clientOf(given.client_id);
  assert.deepEqual([client?.name, client?.redirects], ['A name', ['https://a.example/cb']]);
  assert.throws(() => registerClient({ redirect_uris: ['javascript:alert(1)'] }));
  assert.throws(() => registerClient({ client_name: 'x' }));
  assert.equal(await clientOf(`cl_${Buffer.from(JSON.stringify({ n: 'x', r: ['javascript:alert(1)'] })).toString('base64url')}`), undefined, 'a made-up id is held to the same rules');
  assert.equal(await clientOf('cl_nonsense'), undefined);
});

test('a client’s published document must name itself and read as good', async () => {
  const at = 'https://client.example/oauth/metadata.json';
  const serving = (doc: unknown, status = 200) => (async () => new Response(JSON.stringify(doc), { status })) as typeof fetch;
  const ok = await clientOf(at, serving({ client_id: at, client_name: 'Published', redirect_uris: ['https://client.example/cb'] }));
  assert.equal(ok?.name, 'Published');
  const other = 'https://client.example/oauth/other.json';
  assert.equal(await clientOf(other, serving({ client_id: at, redirect_uris: ['https://client.example/cb'] })), undefined, 'its id must be its own address');
  assert.equal(await clientOf('https://client.example/bad.json', serving({ client_id: 'https://client.example/bad.json', redirect_uris: ['javascript:x'] })), undefined);
  assert.equal(await clientOf('https://client.example/gone.json', serving({}, 404)), undefined);
  assert.equal(await clientOf('https://client.example/', serving({})), undefined, 'it needs a path');
  assert.equal(await clientOf('http://client.example/x.json', serving({})), undefined, 'and https');
});
