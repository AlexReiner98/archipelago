// What a server pack asks of its hosts, made by the kernel: a secret it never sees, a token the kernel signs with a
// key it keeps for the pack and trades for an account's, secrets kept from a host's answer; and what a pack may
// declare, and the acts on a workspace it may ask for only once that workspace connected it.
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { openDb } from '../src/db.ts';
import { connectAct, samePlace } from '../src/server-connect.ts';
import { checkServerPack, OWN_PACKS, loadServerPacks, type ServerPackFile } from '../src/server-packs.ts';
import { hostRequest, serverSecret } from '../src/server-requests.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const heard: { method: string; url: string; auth: string }[] = [];
const host = createServer((req, res) => {
  const auth = req.headers.authorization ?? '';
  heard.push({ method: req.method!, url: req.url!, auth });
  const say = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const [head, body, sig] = auth.replace('Bearer ', '').split('.');
  const signed = Boolean(sig) && createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, sig, 'base64url') ? JSON.parse(Buffer.from(body, 'base64url').toString()) : undefined;
  if (req.url === '/who') return signed ? say(200, { iss: signed.iss, lasts: signed.exp - signed.iat }) : say(401, { message: 'Bad credentials' });
  if (req.method === 'POST' && req.url === '/trade/5') return signed ? say(201, { token: 'tok-5', until: new Date(Date.now() + 3600_000).toISOString() }) : say(401, { message: 'no' });
  if (req.url === '/mine') return say(auth === 'Bearer tok-5' ? 200 : 401, { auth });
  if (req.method === 'POST' && req.url === '/make') return say(201, { slug: 'made', pem: 'NEW KEY', hook: 'new-hook' });
  say(404, { message: 'Not Found' });
});
await new Promise<void>((r) => host.listen(0, '127.0.0.1', r));
after(() => host.close());
const base = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;

const pack: ServerPackFile = {
  id: 'signer',
  version: '1',
  title: 'Signer',
  reach: {
    server: {},
    hosts: [{ id: 'api', base: `${base}/`, sign: { key: 'key', issuer: 'iss', minutes: 5 }, exchange: { path: '/trade/{as}', token: 'token', expires: 'until' } }],
    secrets: [{ name: 'key', env: 'SIGNER_KEY' }, { name: 'iss' }, { name: 'hook' }],
  },
};

test('a host that signs: the kernel signs with the key it holds, trades for an account\'s token once, and keeps what a host hands over', async () => {
  const control = await openDb();
  // A key the server's environment holds, under the name the pack declares for it, its line breaks written as \n.
  Object.assign(process.env, { PELAGO_SIGNER_KEY: pem.replaceAll('\n', '\\n'), PELAGO_SECRET_SIGNER_ISS: '9' });
  after(() => {
    delete process.env.PELAGO_SIGNER_KEY;
    delete process.env.PELAGO_SECRET_SIGNER_ISS;
  });
  assert.deepEqual(await hostRequest(control, pack, { host: 'api', path: '/who' }), { status: 200, body: { iss: '9', lasts: 360 } });
  assert.equal((await hostRequest(control, pack, { host: 'api', path: '/who', anonymous: true })).status, 401, 'anonymous: no credential');
  assert.equal(heard.at(-1)!.auth, '');
  // As an account: traded for once, then kept until it runs out.
  for (let i = 0; i < 3; i++) assert.equal((await hostRequest(control, pack, { host: 'api', path: '/mine', as: '5' })).status, 200);
  assert.equal(heard.filter((h) => h.url === '/trade/5').length, 1);
  await assert.rejects(hostRequest(control, pack, { host: 'api', path: '/mine', as: '../5' }), /cannot name an account/);
  await assert.rejects(hostRequest(control, pack, { host: 'api', path: 'https://elsewhere.test/x' }), /outside the host/);
  await assert.rejects(hostRequest(control, pack, { host: 'nowhere', path: '/' }), /declares no host/);

  // What a host hands over as a secret is the kernel's, sealed, and left out of what the pack is given.
  const made = await hostRequest(control, pack, { host: 'api', method: 'POST', path: '/make', anonymous: true, keep: { pem: 'key', hook: 'hook' } });
  assert.deepEqual(made, { status: 201, body: { slug: 'made' }, kept: ['key', 'hook'] });
  assert.equal(await serverSecret(control, pack, 'key'), 'NEW KEY', 'kept at run time, it stands before the environment');
  assert.match((await control.query<{ value: string }>(`select value from control_value where key = 'pack_secret:signer:hook'`)).rows[0].value, /^sealed:v1:/);
  await assert.rejects(hostRequest(control, pack, { host: 'api', method: 'POST', path: '/make', anonymous: true, keep: { pem: 'undeclared' } }), /declares no secret "undeclared"/);
  // A token traded for with the old key is not kept past a new one.
  await assert.rejects(hostRequest(control, pack, { host: 'api', path: '/mine', as: '5' }));
});

test('what a server pack may declare, and the acts on a workspace only once it connected the pack', async () => {
  const ok = { id: 'x', version: '1', title: 'X' };
  const with_ = (reach: Record<string, unknown>, server: Record<string, unknown> = {}) => ({ ...ok, reach: { ...reach, server } }) as never;
  assert.match(checkServerPack(with_({ hosts: [{ id: 'api', base: 'https://a.test', secret: 'token' }] }), OWN_PACKS).join(), /names the secret "token", which it does not declare/);
  assert.match(checkServerPack(with_({ secrets: [{ name: 'k' }], hosts: [{ id: 'api', base: 'https://a.test', exchange: { path: '/t', token: 't', expires: 'e' } }] }), OWN_PACKS).join(), /an exchange trades a signed token/);
  assert.match(checkServerPack(with_({}, { aliases: { '/api/change': 'hook/x' } }), OWN_PACKS).join(), /cannot be an address of its own[\s\S]*leads to no route/);
  assert.match(checkServerPack(with_({}, { pages: [{ id: 'p', file: 'new.html', form_action: 'web' }] }), OWN_PACKS).join(), /sends a form to no host/);
  // The kernel's own packs folder holds workspace packs too: only those marked for the server are read as server packs.
  const own = loadServerPacks([OWN_PACKS]);
  assert.deepEqual([own.packs.map((p) => p.file.id), own.refused], [['github_app'], []]);

  const control = await openDb();
  const at = { has: async () => true, get: async () => { throw new Error('reached a workspace'); }, hold: () => () => {} } as never;
  const acting = with_({}, { acts: ['workspace.add', 'workspace.deliver', 'connection.make'] }) as ServerPackFile;
  await assert.rejects(connectAct(at, control, acting, 'workspace.add', { connection: '42', type: 'software.repo', unique: 'remote', items: [] }), /No workspace here has connected "42"/);
  await assert.rejects(connectAct(at, control, acting, 'workspace.deliver', { connection: '42', event: 'repo.push' }), /No workspace here has connected "42"/);
  await assert.rejects(connectAct(at, control, acting, 'connection.make', { id: '42', state: 'default.guessed' }), /not started from Archipelago/);
});

test('two addresses are of the same place however each is written', () => {
  for (const [a, b] of [
    ['https://github.com/Acme/Site', 'git@github.com:acme/site.git'],
    ['https://github.com/acme/site/tree/main', 'https://github.com/acme/site.git'],
    ['https://someone@github.com/acme/site/', 'github.com/acme/site'],
  ])
    assert.equal(samePlace(a, b), true, `${a} ~ ${b}`);
  for (const [a, b] of [
    ['https://github.com/acme/site', 'https://github.com/acme/site-tools'],
    ['https://github.com/acme/site', 'https://gitlab.com/acme/site'],
    ['', ''],
  ])
    assert.equal(samePlace(a, b), false, `${a} !~ ${b}`);
});
