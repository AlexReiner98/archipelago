import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { clientAddress, trustedProxies } from '../src/address.ts';
import { createToken } from '../src/auth.ts';
import { packsWith } from './map.ts';
import { serve, closers } from './serve.ts';

test('the hook says which repository a session is in without the name and password its address may carry', async () => {
  // A server that only keeps what it is sent.
  const heard: { remote?: string }[] = [];
  const listener = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.url !== '/hooks/events') heard.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r));
  closers.push(async () => void listener.close());
  const project = mkdtempSync(join(tmpdir(), 'pelago-checkout-'));
  const git = (...args: string[]) => new Promise<void>((done, fail) => spawn('git', ['-C', project, ...args], { stdio: 'ignore' }).on('close', (code) => (code === 0 ? done() : fail(new Error(`git ${args[0]} failed`)))).on('error', fail));
  await git('init', '--quiet');
  await git('remote', 'add', 'origin', 'https://someone:ghp_notforanyone@github.com/acme/site.git');
  await new Promise<void>((done) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'pelago-hook.mjs'), 'session-start'], { env: { ...process.env, PELAGO_URL: `http://127.0.0.1:${(listener.address() as AddressInfo).port}`, PELAGO_AGENT_TOKEN: '' }, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('close', () => done());
    child.stdin!.end(JSON.stringify({ session_id: 'desk-2', cwd: project }));
  });
  assert.deepEqual(heard.map((h) => h.remote), ['https://github.com/acme/site.git']);
});

test('where a request came from is what the trusted proxies say, not what the caller wrote ahead of them', async () => {
  const hosted = trustedProxies('cloudflare');
  const bare = trustedProxies();
  // Straight to the server: the connection is the caller, whatever the header says.
  assert.equal(clientAddress(undefined, '198.51.100.7', bare), '198.51.100.7');
  assert.equal(clientAddress('203.0.113.77', '198.51.100.7', bare), '198.51.100.7');
  // Through a platform's balancer on a private network, and Cloudflare before it: the address Cloudflare was reached from.
  assert.equal(clientAddress('198.51.100.7, 172.70.1.2', '::ffff:10.0.3.4', hosted), '198.51.100.7');
  assert.equal(clientAddress('198.51.100.7, 172.70.1.2, 10.9.9.9', '10.0.3.4', hosted), '198.51.100.7');
  assert.equal(clientAddress(['198.51.100.7', '2606:4700::1'], '10.0.3.4', hosted), '198.51.100.7');
  assert.equal(clientAddress('2001:db8::5, 172.70.1.2', '10.0.3.4', hosted), '2001:db8::5');
  // What the caller wrote himself stands before it, and is not believed: one made-up address or ten.
  assert.equal(clientAddress('203.0.113.77, 198.51.100.7, 172.70.1.2', '10.0.3.4', hosted), '198.51.100.7');
  assert.equal(clientAddress('10.1.1.1, 172.70.9.9, 198.51.100.7, 172.70.1.2', '10.0.3.4', hosted), '198.51.100.7');
  assert.equal(clientAddress('not an address, 198.51.100.7, 172.70.1.2', '10.0.3.4', hosted), '198.51.100.7');
  // A server that was not told about Cloudflare takes Cloudflare for the caller: wrong, but nothing a caller can choose.
  assert.equal(clientAddress('203.0.113.77, 198.51.100.7, 172.70.1.2', '10.0.3.4', bare), '172.70.1.2');
  // From inside, through nothing but trusted proxies, it is the first of them.
  assert.equal(clientAddress('10.1.1.1', '127.0.0.1', bare), '10.1.1.1');
  assert.equal(clientAddress(undefined, undefined, bare), '');
  // Other proxies are named as networks; what is not one is refused when the server starts.
  assert.equal(clientAddress('198.51.100.7, 192.0.2.9', '10.0.3.4', trustedProxies('192.0.2.0/24, 2001:db8:1::/48')), '198.51.100.7');
  assert.throws(() => trustedProxies('cloudfront'), /PELAGO_TRUSTED_PROXIES: "cloudfront" is not an address/);

  // On a server: a caller who claims a new address with every request is still one caller.
  const { base } = await serve('tokens', { open: { each: 3 } });
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) seen.push((await fetch(base + '/connect/setup.mjs', { headers: { 'x-forwarded-for': `203.0.113.${i}, 198.51.100.7` } })).status);
  assert.deepEqual(seen, [200, 200, 200, 429, 429]);
  assert.equal((await fetch(base + '/connect/setup.mjs', { headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.8' } })).status, 200, 'and another caller is another');
});

test('refused tokens are counted by address, a backup unpacks only so far, and the UI comes with a policy for what it may load', async () => {
  const { base, call, workspaces } = await serve('tokens', { refused: { each: 3 } });
  const db = (await workspaces.get('default')).pelago.db;
  const good = (await createToken(db, 'default', { kind: 'agent', name: 'robot' })).token;
  const wrong = `pel_default_${'0'.repeat(40)}`;
  const from = (token: string | undefined, address: string) =>
    fetch(`${base}/agent/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': address, ...(token && { authorization: `Bearer ${token}` }) }, body: '{}' }).then((r) => r.status);
  // Three refusals from one address, and the fourth request is not looked at, whatever token it carries.
  assert.deepEqual([await from(wrong, '198.51.100.1'), await from(undefined, '198.51.100.1'), await from('nonsense', '198.51.100.1')], [401, 401, 401]);
  assert.deepEqual([await from(wrong, '198.51.100.1'), await from(good, '198.51.100.1')], [429, 429]);
  // Another address is not held up by it, and a good token is never counted.
  for (let i = 0; i < 5; i++) assert.equal(await from(good, '198.51.100.2'), 200);
  assert.equal((await call('/agent/search', good, {})).status, 200);

  // A file that unpacks to more than a backup is taken to be is refused before it is read.
  const { parseBackup } = await import('../src/backup.ts');
  assert.throws(() => parseBackup(gzipSync(Buffer.alloc(257_000_000, 0x20))), /unpacks to more than 256 MB/);
  assert.throws(() => parseBackup(Buffer.from('not a backup')), /not an Archipelago backup file/);

  // The page may load its own script and stylesheet and talk to this server; the public page has its own, stricter still.
  const page = await fetch(base + '/');
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'; script-src 'self'; style-src 'self';.*frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/app.js')).headers.get('x-content-type-options'), 'nosniff');
  // An answer in JSON is never sniffed either, refused or not (src/reply.ts).
  for (const r of [await fetch(base + '/agent/search', { method: 'POST', headers: { authorization: `Bearer ${good}`, 'content-type': 'application/json' }, body: '{}' }), await fetch(base + '/agent/search', { method: 'POST', body: '{}' })]) {
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', `${r.status}`);
    assert.match(r.headers.get('content-type') ?? '', /^application\/json/);
  }
  // A style's own code is drawn in a frame of the page's own, which is sandboxed, may reach nothing outside itself, and may be framed only here.
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-src 'self'/);
  const frame = await fetch(base + '/draw.html');
  const framePolicy = frame.headers.get('content-security-policy') ?? '';
  assert.match(framePolicy, /^sandbox allow-scripts; default-src 'none'; script-src 'self' blob: data: 'sha256-[\w+/=]+' 'sha256-[\w+/=]+'; worker-src blob: data:;.*connect-src 'none'; webrtc 'block';/);
  // Its two scripts are written into it, each allowed by its hash and nothing else written in is.
  const frameText = await frame.text();
  const inline = [...frameText.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => createHash('sha256').update(m[1]).digest('base64'));
  assert.equal(inline.length, 2);
  for (const hash of inline) assert.ok(framePolicy.includes(`'sha256-${hash}'`), 'each script written in is allowed by its own hash');
  assert.doesNotMatch(/script-src [^;]*/.exec(framePolicy)![0], /unsafe-inline/, 'and no other script written in is allowed');
  assert.equal((await fetch(base + '/draw.js')).headers.get('access-control-allow-origin'), '*');
  assert.equal((await fetch(base + '/draw-marks.js')).headers.get('access-control-allow-origin'), '*');
  assert.equal((await fetch(base + '/app.js')).headers.get('access-control-allow-origin'), null, 'and nothing else here is given to strangers');

  // The page names its files by the UI's version, so they are kept for good, and asks for every module it imports at once.
  const html = await page.text();
  const version = /src="\/app\.js\?v=(\w+)"/.exec(html)?.[1];
  assert.ok(version, 'the page names its script by version');
  assert.match(html, new RegExp(`<link rel="modulepreload" href="/base\\.js\\?v=${version}" />`));
  assert.match(html, new RegExp(`href="/style\\.css\\?v=${version}"`));
  assert.match(html, /href="\/layout\.css"/, 'what the server makes from the packs is not versioned');
  const kept = await fetch(`${base}/app.js?v=${version}`);
  assert.equal(kept.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.match(await kept.text(), new RegExp(`from '\\./base\\.js\\?v=${version}'`), 'and the modules it imports are named the same way');
  assert.equal((await fetch(`${base}/app.js?v=old`)).headers.get('cache-control'), 'no-store', 'an address of another version is never kept');
  assert.equal((await fetch(`${base}/app.js`)).headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('cache-control'), 'no-store', 'the page itself is asked for every time');
  assert.doesNotMatch(frameText, /<script src=/, 'the frame names no script to fetch: an origin of its own keeps none');
});

test('a writing shared is public at its address with no login, until it is taken down', async () => {
  // A test pack's writing is what can be read whole (test/packs/reader).
  const { call, base } = await serve('off', undefined, undefined, packsWith('reader'));
  const made = await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'n', type: 'clipping', title: 'IRAP', body: 'Call first.', visibility: 'shared' },
      { op: 'create', ref: 'd', type: 'writing', title: 'Funding', body: 'Intro.\n\n{n}', visibility: 'shared' },
      { op: 'link', type: 'part_of', from: 'n', to: 'd' },
    ],
  });
  const { d, n } = made.result.created;
  assert.match((await call('/agent/share_create', undefined, { id: d })).error, /humans only/);
  // A section's figure is kept with it when it is shared; a figure of anything it does not bring in is not.
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
  const other = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'o', type: 'clipping', title: 'Not in it' }] })).result.created.o;
  for (const id of [n, other]) assert.equal((await call('/api/picture_put', undefined, { result: id, data: png, content_type: 'image/png' })).status, 200);
  const shared = (await call('/api/share_create', undefined, { id: d })).result;
  assert.equal(shared.address, `/p/default/${d}`);
  const page = await fetch(base + shared.address);
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /noindex/, 'a public view is for search engines too');
  const data = await fetch(`${base}${shared.address}/data`);
  assert.equal(data.status, 200);
  const doc = (await data.json()) as { title: string; parts: { text?: string; section?: { title: string; picture?: boolean } }[] };
  assert.deepEqual([doc.title, doc.parts.map((p) => p.section?.title ?? p.text)], ['Funding', ['Intro.', 'IRAP']]);
  assert.equal(doc.parts[1].section?.picture, true);
  const figure = await fetch(`${base}${shared.address}/picture/${n}`);
  assert.deepEqual([figure.status, figure.headers.get('content-type')], [200, 'image/png']);
  assert.equal((await fetch(`${base}${shared.address}/picture/${other}`)).status, 404);
  // The same page reads a document with the reader's own sign-in, to print it; the page itself holds nothing.
  const read = await fetch(`${base}/read/${d}`);
  assert.equal(read.status, 200);
  assert.match(read.headers.get('content-security-policy') ?? '', /img-src 'self' data:/);
  assert.equal((await fetch(`${base}/read/not-an-id`)).status === 200, false);
  // The secret links that went before are gone.
  assert.notEqual((await fetch(`${base}/s/default/${'0'.repeat(48)}/data`)).status, 200);
  await call('/api/share_revoke', undefined, { id: d });
  assert.equal((await fetch(`${base}${shared.address}/data`)).status, 404);
  assert.equal((await fetch(`${base}${shared.address}/picture/${n}`)).status, 404);
});
