// The drawing host (src/draw-host.ts): a second name that serves the frame a drawing runs in and nothing else, so the
// frame has an origin of its own, never the page's; its policy, and the page marked with where to frame it.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { drawHosts, drawHostServes } from '../src/draw-host.ts';
import { drawPolicy, markPage } from '../src/page-policies.ts';
import { createHttpServer } from '../src/server.ts';
import { Workspaces } from '../src/workspaces.ts';

test('a configured drawing host frames for every page, and is never framed by its own origin', () => {
  const pages = ['http://127.0.0.1:3100', 'http://localhost:3100', 'https://app.example.com'];
  const at = drawHosts(3100, pages, { host: 'Draw.Example.com' });
  assert.equal(at.originFor('app.example.com'), 'https://draw.example.com');
  assert.equal(at.originFor('127.0.0.1:3100'), 'https://draw.example.com');
  assert.equal(at.originFor('draw.example.com'), undefined, 'the drawing host is no page');
  assert.ok(at.only('draw.example.com'));
  assert.ok(!at.only('app.example.com'));
  assert.deepEqual(at.framedBy('draw.example.com'), pages);
  assert.equal(at.framedBy('app.example.com', 'cross-site'), undefined, 'at a page, the frame is served as before');
  // A loopback name given as the host is reached over plain http, and is no page's origin even though it is in the list.
  const local = drawHosts(3199, ['http://127.0.0.1:3199', 'http://localhost:3199'], { host: 'localhost:3199' });
  assert.equal(local.originFor('127.0.0.1:3199'), 'http://localhost:3199');
  assert.deepEqual(local.framedBy('localhost:3199'), ['http://127.0.0.1:3199']);
  assert.throws(() => drawHosts(3100, pages, { host: 'draw.example.com/x' }), /a name and a port/);
});

test('in dev, each loopback name draws for the other, and only when framed from the other site', () => {
  const at = drawHosts(3100, [], { loopback: true });
  assert.equal(at.originFor('127.0.0.1:3100'), 'http://localhost:3100');
  assert.equal(at.originFor('localhost:3100'), 'http://127.0.0.1:3100');
  assert.equal(at.originFor('app.example.com'), undefined, 'another name frames at its own origin');
  assert.equal(at.originFor('localhost:3101'), undefined, 'another port is another server');
  assert.ok(!at.only('localhost:3100'), 'both names are pages too');
  assert.deepEqual(at.framedBy('localhost:3100', 'cross-site'), ['http://127.0.0.1:3100']);
  assert.equal(at.framedBy('localhost:3100', 'same-origin'), undefined, 'asked for by its own page, the frame has no origin');
  assert.equal(at.framedBy('localhost:3100'), undefined);
  const none = drawHosts(3100, []);
  assert.equal(none.originFor('127.0.0.1:3100'), undefined, 'not dev and none set: the page frames at its own origin');
  assert.equal(none.framedBy('localhost:3100', 'cross-site'), undefined);
});

test('the drawing host serves the frame and drawings with their service workers, and nothing else', () => {
  for (const path of ['/draw.html', '/three.js', '/drawing/abc/index.js', '/drawing/abc/sw.js']) assert.ok(drawHostServes(path), path);
  for (const path of ['/', '/app.js', '/api/view', '/mcp', '/health', '/drawing', '/base.js', '/draw.js', '/draw-sw.js']) assert.ok(!drawHostServes(path), path);
});

test('at the drawing host the frame keeps its origin, its workers start from it, and only the pages named frame it', () => {
  const policy = drawPolicy(false, false, ['abc'], ['http://127.0.0.1:3100']);
  assert.match(policy, /^sandbox allow-scripts allow-same-origin; default-src 'none'; script-src 'self' blob: data: 'sha256-abc'; worker-src 'self' blob: data:;/);
  assert.match(policy, /connect-src 'none'; webrtc 'block';/);
  assert.match(policy, /; frame-ancestors http:\/\/127\.0\.0\.1:3100$/);
  assert.doesNotMatch(policy, /'self'[^;]*$/, "framed by 'self' it would be the page's");
  // Unsandboxed or not, at the drawing host the sandbox stays; opened, it is the page's own and nothing else changes.
  assert.equal(drawPolicy(false, true, [], ['http://127.0.0.1:3100']), drawPolicy(false, false, [], ['http://127.0.0.1:3100']));
  assert.match(drawPolicy(false, false), /^sandbox allow-scripts; .*worker-src blob: data:;/);
  assert.doesNotMatch(drawPolicy(false, false), /frame-ancestors/);
  assert.equal(drawPolicy(true, false), "frame-ancestors 'self'");
});

test('the page is told where to frame its drawings, and its first frame is put there', () => {
  const page = '<html lang="en"><body><iframe class="drawing-sandbox" id="drawing-sandbox" sandbox="allow-scripts" src="/draw.html?v=abc"></iframe></body></html>';
  const marked = markPage(page, { drawOrigin: 'http://localhost:3100' });
  assert.match(marked, /^<html data-draw-origin="http:\/\/localhost:3100" lang/);
  assert.match(marked, /sandbox="allow-scripts allow-same-origin" src="http:\/\/localhost:3100\/draw\.html\?v=abc"/);
  assert.equal(markPage(page, {}), page);
});

// A server answering a drawing host of its own: what each name serves.
const root = mkdtempSync(join(tmpdir(), 'pelago-draw-host-'));
const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(import.meta.dirname, '..', 'packs') });
const probe = createHttpServer(workspaces, 0);
await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
const port = (probe.address() as AddressInfo).port;
await new Promise((r) => probe.close(r));
const server = createHttpServer(workspaces, port, { publicHosts: ['app.example.com'], draw: { host: 'draw.example.com' } });
await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
after(async () => {
  server.close();
  await workspaces.closeAll();
});
/** A request to this server under a host name of our choosing. */
const get = (path: string, host: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host, ...headers } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d)).on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject).end();
  });

test('a request at the drawing host finds the frame, and nothing of the page', async () => {
  const frame = await get('/draw.html', 'draw.example.com');
  assert.equal(frame.status, 200);
  assert.match(String(frame.headers['content-security-policy']), /^sandbox allow-scripts allow-same-origin;.*frame-ancestors http:\/\/127\.0\.0\.1:\d+ http:\/\/localhost:\d+ https:\/\/app\.example\.com$/);
  // Asked for opened at the drawing host, it is not: only the page's own origin opens it.
  assert.match(String((await get('/draw.html?open=1', 'draw.example.com')).headers['content-security-policy']), /^sandbox allow-scripts allow-same-origin;/);
  assert.equal((await get('/three.js', 'draw.example.com')).status, 200);
  for (const path of ['/', '/app.js', '/health', '/whoami', '/connect/setup.mjs']) assert.equal((await get(path, 'draw.example.com')).status, 404, path);
  assert.equal((await get('/draw.html', 'draw.example.com', {}, 'POST')).status, 404);
});

test('the page frames its drawings at the drawing host, and its own host serves the frame as before', async () => {
  const page = await get('/', 'app.example.com');
  assert.match(page.body, /<html data-draw-origin="https:\/\/draw\.example\.com"/);
  assert.match(page.body, /sandbox="allow-scripts allow-same-origin" src="https:\/\/draw\.example\.com\/draw\.html\?v=\w+"/);
  // At the page's own host the frame has no origin, whoever asks: the fallback a page without a drawing host uses.
  const own = await get('/draw.html', 'app.example.com', { 'sec-fetch-site': 'cross-site' });
  assert.match(String(own.headers['content-security-policy']), /^sandbox allow-scripts; /);
  assert.doesNotMatch(String(own.headers['content-security-policy']), /frame-ancestors/);
});

test('a drawing by hash at the drawing host goes on to its own route', async () => {
  // It by hash goes on to its own route (src/drawing-files.ts): it answers what it has not with an empty 404.
  const none = await get('/drawing/not-a-hash/index.js', 'draw.example.com');
  assert.equal(none.status, 404);
  assert.equal(none.body, '', 'answered by the drawing route, not refused by the host');
});

test('the server’s own Chrome, reached by a name of its own, is not sent to the drawing host', async () => {
  const before = process.env.PELAGO_LOOK_ORIGIN;
  process.env.PELAGO_LOOK_ORIGIN = 'http://app-beside:3100';
  const beside = createHttpServer(workspaces, 0, { publicHosts: ['app.example.com'], draw: { host: 'draw.example.com' } });
  await new Promise<void>((r) => beside.listen(0, '127.0.0.1', r));
  const at2 = (beside.address() as AddressInfo).port;
  try {
    const at = (host: string) => new Promise<string>((resolve, reject) => request({ host: '127.0.0.1', port: at2, path: '/', headers: { host } }, (res) => { let b = ''; res.on('data', (d) => (b += d)).on('end', () => resolve(b)); }).on('error', reject).end());
    assert.doesNotMatch(await at('app-beside:3100'), /data-draw-origin/);
    assert.match(await at('app.example.com'), /data-draw-origin="https:\/\/draw\.example\.com"/);
  } finally {
    if (before === undefined) delete process.env.PELAGO_LOOK_ORIGIN;
    else process.env.PELAGO_LOOK_ORIGIN = before;
    await new Promise((r) => beside.close(r));
  }
});
