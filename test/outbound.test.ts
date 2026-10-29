// A call to an address someone gave the server: no redirect followed, and where the server refuses its own network,
// no private address reached, however the name resolves when it is called (the audit of 29 Oct 2026).
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { asker } from '../src/model.ts';
import { guardedFetch } from '../src/outbound.ts';
import { fresh, human, make } from './map.ts';

/** A server on this machine: one path answers, /hop redirects to it with a 307, which keeps a POST a POST. */
const heard: string[] = [];
const local: Server = createServer((req, res) => {
  heard.push(`${req.method} ${req.url}`);
  // Each connection closed after its answer: a kept one reused as the server times it out would fail a test for nothing.
  res.setHeader('connection', 'close');
  if (req.url?.startsWith('/hop')) return res.writeHead(307, { location: `http://127.0.0.1:${port()}/inside/chat/completions` }).end();
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'secret' } }] }));
});
await new Promise<void>((r) => local.listen(0, '127.0.0.1', r));
const port = () => (local.address() as AddressInfo).port;
after(() => {
  local.closeAllConnections();
  local.close();
});

async function withEnv(set: Record<string, string | undefined>, run: () => Promise<void>) {
  const before = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]));
  const put = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  };
  put(set);
  try {
    await run();
  } finally {
    put(before);
  }
}
const open = { PELAGO_PRIVATE_URLS: undefined, PELAGO_MODEL_PRIVATE_URLS: undefined };
const refused = { PELAGO_PRIVATE_URLS: undefined, PELAGO_MODEL_PRIVATE_URLS: 'off' };

test('a redirect is never followed, even where private addresses are allowed', async () => {
  await withEnv(open, async () => {
    heard.length = 0;
    const ask = asker('k', { url: `http://127.0.0.1:${port()}/hop` }, guardedFetch, 2000);
    await assert.rejects(ask({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }), /could not be reached/);
    assert.ok(!heard.some((h) => h.includes('/inside')), 'the redirect’s target is never asked');
    assert.equal((await guardedFetch(`http://127.0.0.1:${port()}/ok`)).status, 200, 'an address that answers, answers');
  });
});

test('where the server refuses its own network, no call reaches it: by address, by name, or by what a name resolves to', async () => {
  await withEnv(refused, async () => {
    heard.length = 0;
    // localhost. is not caught by its name: the address it resolves to, as the socket is handed it, is.
    for (const url of [`http://127.0.0.1:${port()}/`, `http://localhost:${port()}/`, `http://localhost.:${port()}/`, `http://[::ffff:127.0.0.1]:${port()}/`, 'http://169.254.169.254/latest/meta-data/']) {
      await assert.rejects(guardedFetch(url, { signal: AbortSignal.timeout(2000) }), /own network/, url);
    }
    assert.deepEqual(heard, [], 'nothing on this machine was asked');
  });
});

test('check_connections reaches no private address where they are refused, and follows no redirect', async () => {
  const l = await fresh();
  const created = await make(l, [
    { op: 'create', ref: 'inside', type: 'connection', title: 'Inside', props: { url: `http://127.0.0.1:${port()}/` } },
    { op: 'create', ref: 'hop', type: 'connection', title: 'Hop', props: { url: `http://127.0.0.1:${port()}/hop` } },
  ]);
  heard.length = 0;
  await withEnv(refused, async () => {
    const out = await l.checkConnections(human);
    assert.deepEqual(out.map((c) => c.status), ['unavailable', 'unavailable']);
    assert.deepEqual(heard, [], 'the scan reached nothing');
  });
  await withEnv(open, async () => {
    const out = await l.checkConnections(human);
    assert.equal(out.find((c) => c.id === created.inside)!.status, 'available');
    assert.equal(out.find((c) => c.id === created.hop)!.status, 'unavailable', 'a redirect is not followed');
    assert.ok(!heard.some((h) => h.includes('/inside')));
  });
});
