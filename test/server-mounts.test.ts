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
    assert.match(r.body, new RegExp(`site workspace=acme;path=${path}<`));
  }
});

test('with no pack mounted, the kernel answers /p/ as before', async () => {
  const { base } = await server(false);
  const r = await fetch(`${base}/p/acme/e_abc12345`);
  assert.equal(r.status, 404);
  assert.doesNotMatch(await r.text(), /workspace=acme/);
});
