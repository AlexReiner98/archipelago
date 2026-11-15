// Signing up or in without a code in the mail (e_9ewt9kc6): Google or GitHub prove the address (identity's social.ts),
// a passkey added once signs in with a tap (passkeys.ts), and each ends in the same ticket (verified.ts): a guest map
// kept as its owner's, or a workspace signed in to. The providers are stood in for by a fetch handed in.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { configureSocial } from '../packs/identity/kernel/social.ts';
import { serve } from './serve.ts';

const FIXTURES = join(import.meta.dirname, 'keep-packs');
before(() => Object.assign(process.env, { PELAGO_SERVER_PACKS: FIXTURES }));
after(() => void delete process.env.PELAGO_SERVER_PACKS);

const ENV: Record<string, string> = { PELAGO_GOOGLE_CLIENT_ID: 'gid', PELAGO_GOOGLE_CLIENT_SECRET: 'gsecret', PELAGO_GITHUB_CLIENT_ID: 'hid', PELAGO_GITHUB_CLIENT_SECRET: 'hsecret' };
const jwt = (claims: object) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
/** What each provider answers, set by each step. */
let google: object = {};
let github: object[] = [];
const asked: string[] = [];
configureSocial({
  env: (name) => ENV[name],
  fetch: async (url, init) => {
    asked.push(`${url} ${String(init?.body ?? '')}`);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ id_token: jwt(google) });
    if (url.startsWith('https://github.com/login/oauth/access_token')) return Response.json({ access_token: 'gho_x' });
    if (url === 'https://api.github.com/user/emails') return Response.json(github);
    return new Response('{}', { status: 404 });
  },
});

test('Google and GitHub prove the address: a guest map kept as its owner’s, then signed in to again', async () => {
  const { call, base } = await serve('tokens');
  const made = (await call('/guest', undefined, {})).result;
  const page = made.page_token as string;
  assert.deepEqual((await call('/connect/ways', undefined, undefined, 'GET')).social, ['google', 'github']);

  // Back from the provider: the browser is sent to the page, with a ticket or why not.
  const back = async (provider: string, url: string, extra: Record<string, string> = {}) => {
    const state = new URL(url).searchParams.get('state')!;
    const res = await fetch(`${base}/connect/social/${provider}/callback?${new URLSearchParams({ code: 'c', state, ...extra })}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    return new URLSearchParams(res.headers.get('location')!.split('?')[1]);
  };
  const start = async (body: object, token?: string) => {
    const said = await call('/connect/social', token, body);
    assert.equal(said.status, 200, said.error);
    return said.url as string;
  };

  // Only the guest map's owner starts keeping it; an unknown provider is refused.
  assert.equal((await call('/connect/social', made.link.split('/g/')[1], { provider: 'google', for: 'keep' })).status, 403);
  assert.equal((await call('/connect/social', page, { provider: 'myspace', for: 'keep' })).status, 400);

  // An address Google has not verified is not taken; nor is a state twice.
  google = { aud: 'gid', iss: 'https://accounts.google.com', email: 'ana@example.com', email_verified: false };
  const unverified = await start({ provider: 'google', for: 'keep' }, page);
  assert.match((await back('google', unverified)).get('failed') ?? '', /no verified address/);
  assert.match((await back('google', unverified)).get('failed') ?? '', /ran out/);

  google = { ...google, email: 'Ana@Example.com', email_verified: true };
  const url = await start({ provider: 'google', for: 'keep', machine: 'a'.repeat(32) }, page);
  const sent = new URL(url);
  assert.equal(sent.origin + sent.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(sent.searchParams.get('redirect_uri'), `${base}/connect/social/google/callback`);
  assert.equal(sent.searchParams.get('scope'), 'openid email');
  assert.equal(sent.searchParams.get('code_challenge_method'), 'S256');
  const ticket = (await back('google', url)).get('ticket')!;
  assert.match(asked.at(-1)!, /code_verifier=/, 'the code is traded with its verifier');
  const kept = await call('/connect/verified', undefined, { ticket });
  assert.equal(kept.status, 200, kept.error);
  assert.equal(kept.workspace.id, made.workspace.id, 'the same map, kept');
  assert.ok(Date.parse(kept.trial?.ends) > Date.now(), 'its trial begun');
  const who = await call('/whoami', kept.token, undefined, 'GET');
  assert.deepEqual([who.workspace.guest, who.actor.name], [undefined, 'ana@example.com']);
  assert.equal((await call('/connect/verified', undefined, { ticket })).status, 410, 'a ticket is traded once');

  // Next time, GitHub signs the same address in; an address with no map is told so.
  github = [{ email: 'old@example.com', primary: false, verified: true }, { email: 'ana@example.com', primary: true, verified: true }];
  const again = await call('/connect/verified', undefined, { ticket: (await back('github', await start({ provider: 'github', for: 'sign-in' }))).get('ticket') });
  assert.equal(again.status, 200, again.error);
  assert.equal((await call('/whoami', again.token, undefined, 'GET')).workspace.id, made.workspace.id);
  github = [{ email: 'nobody@example.com', primary: true, verified: true }];
  const none = await call('/connect/verified', undefined, { ticket: (await back('github', await start({ provider: 'github', for: 'sign-in' }))).get('ticket') });
  assert.deepEqual([none.token, none.none], [undefined, 'nobody@example.com']);
});

test('a passkey added while signed in signs in with a signature over a fresh challenge, once each', async () => {
  const { call, base } = await serve('tokens');
  const made = (await call('/guest', undefined, {})).result;
  google = { aud: 'gid', iss: 'https://accounts.google.com', email: 'bo@example.com', email_verified: true };
  const url = (await call('/connect/social', made.page_token, { provider: 'google', for: 'keep' })).url as string;
  const res = await fetch(`${base}/connect/social/google/callback?code=c&state=${new URL(url).searchParams.get('state')}`, { redirect: 'manual' });
  const token = (await call('/connect/verified', undefined, { ticket: new URLSearchParams(res.headers.get('location')!.split('?')[1]).get('ticket') })).token as string;

  const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
  const rp = sha(new URL(base).hostname);
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const id = randomBytes(16);
  const counter = (n: number) => Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const b64 = (b: Buffer) => b.toString('base64url');

  const options = await call('/connect/passkey/add/options', token, {});
  assert.equal(options.status, 200, options.error);
  assert.equal(options.user.name, 'bo@example.com');
  const created = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: base }));
  const data = Buffer.concat([rp, Buffer.from([0x41]), counter(0), Buffer.alloc(16), Buffer.from([0, id.length]), id, Buffer.from([0xa0])]);
  const add = { id: b64(id), clientDataJSON: b64(created), authenticatorData: b64(data), publicKey: b64(publicKey.export({ format: 'der', type: 'spki' })), alg: -7 };
  assert.equal((await call('/connect/passkey/add', undefined, add)).status, 401, 'added only signed in');
  assert.equal((await call('/connect/passkey/add', token, add)).added, b64(id));
  assert.equal((await call('/connect/passkey/add', token, add)).status, 400, 'its challenge is spent');
  assert.equal((await call('/connect/passkey/mine', token, {})).passkeys, 1);

  const signIn = async (n: number, origin = base, key = privateKey) => {
    const { challenge } = await call('/connect/passkey/options', undefined, {});
    const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
    const auth = Buffer.concat([rp, Buffer.from([0x05]), counter(n)]);
    return call('/connect/passkey', undefined, { id: b64(id), clientDataJSON: b64(client), authenticatorData: b64(auth), signature: b64(sign('sha256', Buffer.concat([auth, sha(client)]), key)) });
  };
  const signed = await signIn(1);
  assert.equal(signed.status, 200, signed.error);
  const inside = await call('/connect/verified', undefined, { ticket: signed.ticket });
  assert.equal((await call('/whoami', inside.token, undefined, 'GET')).actor.name, 'bo@example.com');
  assert.equal((await signIn(1)).status, 401, 'a counter that did not move: a copied key');
  assert.equal((await signIn(2, 'https://elsewhere.example')).status, 401, 'signed on another page');
  assert.equal((await signIn(3, base, generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey)).status, 401, 'another key');
  assert.equal((await signIn(4)).status, 200);
});
