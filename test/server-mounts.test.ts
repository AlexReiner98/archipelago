import assert from 'node:assert/strict';
import { request } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { serve } from './serve.ts';

const MOUNTED = join(import.meta.dirname, 'server-packs', 'mounts');

/** A server with the reader pack mounted, or with none. */
async function server(mounted: boolean, sites?: Record<string, string>) {
  if (mounted) process.env.PELAGO_SERVER_PACKS = MOUNTED;
  try {
    return await serve('off', undefined, sites);
  } finally {
    delete process.env.PELAGO_SERVER_PACKS;
  }
}

/** A GET with a Host header of its own, which fetch will not send. */
const getAs = (base: string, host: string, path: string) =>
  new Promise<{ status: number; body: string }>((done, fail) => {
    const url = new URL(path, base);
    request({ hostname: url.hostname, port: url.port, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c)).on('end', () => done({ status: res.statusCode ?? 0, body }));
    }).on('error', fail).end();
  });

test('a pack mounted at public answers /p/ with the parts the kernel parsed, as a page under the reader policy', async () => {
  const { base } = await server(true);
  const page = await fetch(`${base}/p/acme/e_abc12345`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await page.text(), /<p>workspace=acme;id=e_abc12345<\/p>/);
  assert.match(await (await fetch(`${base}/p/acme/e_abc12345/drawing/3`)).text(), /workspace=acme;id=e_abc12345;what=drawing;extra=3/);
  assert.equal((await fetch(`${base}/p/acme/gone`)).status, 404);
  // What the pack gets wrong is answered for it, and not as its page.
  for (const id of ['broken', 'plain']) {
    const r = await fetch(`${base}/p/acme/${id}`);
    assert.equal(r.status, 502, id);
    assert.match(r.headers.get('content-type') ?? '', /json/);
  }
  // An address the mount does not parse is the kernel's.
  assert.equal((await fetch(`${base}/p/acme`)).status, 404);
});

test('a pack mounted at site answers any address on a domain the server names', async () => {
  const { base } = await server(true, { 'reader.example': 'acme' });
  for (const path of ['/', '/about/team']) {
    const r = await getAs(base, 'reader.example', path);
    assert.equal(r.status, 200, path);
    assert.match(r.body, new RegExp(`site workspace=acme;path=${path};host=reader.example;app=http://127\\.0\\.0\\.1:\\d+<`));
  }
  // What the request said is handed on too, for the pack to read and forget: its query, host, referrer, agent, purpose.
  const asked = await getAs(base, 'reader.example', '/about?ref=x&utm_source=y');
  assert.deepEqual(JSON.parse(/<pre>(.*)<\/pre>/.exec(asked.body)![1]), { query: 'ref=x&utm_source=y', host: 'reader.example', referrer: '', agent: '', purpose: '' });
  assert.match(asked.body, /path=\/about;/, 'the path is the path alone');
});

test("with the kernel's own reader alone, an address that is no published document is the kernel's", async () => {
  const { base } = await server(false);
  const r = await fetch(`${base}/p/acme/e_abc12345`);
  assert.equal(r.status, 404);
  assert.doesNotMatch(await r.text(), /workspace=acme/);
});

test("a mounted entry answers JSON, a picture, text and a redirect, each with the kernel's headers", async () => {
  const { base } = await server(true);
  const json = await fetch(`${base}/p/acme/json`);
  assert.deepEqual([json.status, await json.json(), json.headers.get('cache-control'), json.headers.get('x-content-type-options')], [200, { said: 'json' }, 'public, max-age=60', 'nosniff']);
  assert.equal((await fetch(`${base}/p/acme/forgood`)).headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const pic = await fetch(`${base}/p/acme/pic`);
  assert.deepEqual([pic.status, pic.headers.get('content-type'), pic.headers.get('content-security-policy'), Buffer.from(await pic.arrayBuffer()).toString()], [200, 'image/png', "default-src 'none'", 'png']);
  const text = await fetch(`${base}/p/acme/text`);
  assert.deepEqual([text.status, text.headers.get('content-type'), await text.text()], [200, 'text/plain; charset=utf-8', 'plain words']);
  const there = await fetch(`${base}/p/acme/there`, { redirect: 'manual' });
  assert.deepEqual([there.status, there.headers.get('location')], [301, '/elsewhere']);
  // A redirect goes only to this server.
  const away = await fetch(`${base}/p/acme/away`, { redirect: 'manual' });
  assert.deepEqual([away.status, away.headers.get('location')], [302, '/']);
  // A picture or text of a type the kernel does not send is the pack's fault.
  for (const id of ['badpic', 'badtext']) assert.equal((await fetch(`${base}/p/acme/${id}`)).status, 502, id);
});

test("a page a mounted entry makes names the UI's files at their version, and asks for what they import at once", async () => {
  const { base } = await server(true);
  const html = await (await fetch(`${base}/p/acme/ui`)).text();
  assert.match(html, /<script type="module" src="\/doc\.js\?v=[0-9a-f]{12}"/);
  assert.match(html, /<link rel="modulepreload" href="\/doc-lens\.js\?v=/);
  assert.match(html, /<a href="\/doc\.js">/, 'only what a page loads is versioned');
});

test("a stream is the kernel's own, of a published document alone; a pass is answered as with no pack", async () => {
  const { base } = await server(true, { 'reader.example': 'acme' });
  assert.equal((await fetch(`${base}/p/acme/stream`)).status, 404, 'nothing published is listened to');
  const passed = await fetch(`${base}/p/acme/pass`);
  assert.equal(passed.status, 404);
  assert.doesNotMatch(await passed.text(), /workspace=acme/);
  assert.doesNotMatch((await getAs(base, 'reader.example', '/pass')).body, /site workspace=/);
  // A site's domain serves the kernel's own files as every name does: they never reach the pack.
  const script = await getAs(base, 'reader.example', '/doc.js');
  assert.equal(script.status, 200);
  assert.doesNotMatch(script.body, /site workspace=/);
});
