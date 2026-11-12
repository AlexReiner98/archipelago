// A server pack's page listens on a stream the kernel holds (packs/surface/kernel/server-streams.ts): told when a published document
// is published again, refused for one that is not published, and closed when the pack goes.

import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Registry } from '../packs/loader/kernel/packs.ts';
import * as publishedPack from '../packs/publish/kernel/published.ts';
import { closeStreams, serveStream } from '../packs/surface/kernel/server-streams.ts';
import type { ServerPackFile } from '../packs/loader/kernel/server-packs.ts';
import { freshWith, human, make, PACKS } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

const pack = { id: 'reader', reach: { server: { streams: [{ id: 'live', on: 'published' }] } } } as unknown as ServerPackFile;

/** A map with a published page and a draft, and a server answering a pack's streams on it. A map is closed after each test (test/each.ts), so each test has its own. */
async function served(t: TestContext) {
  const l = await freshWith(new Registry([PACKS, join(import.meta.dirname, 'packs'), join(import.meta.dirname, 'fixtures', 'packs')], ['core', 'pages']));
  const made = await make(l, [
    { op: 'create', ref: 'd', type: 'page', title: 'Landing', visibility: 'shared', body: 'What it is, in a line.' },
    { op: 'create', ref: 'draft', type: 'page', title: 'Not yet', visibility: 'shared', body: 'Not published.' },
  ]);
  await publishedPack.publish(kernelContext(l, 'publish'), human, made.d);
  const workspaces = { has: async (id: string) => id === l.workspace, get: async () => ({ pelago: l }) } as any;
  const server = createServer((req, res) => {
    const [, , , stream = '', workspace = '', id = ''] = (req.url ?? '').split('/');
    void serveStream(res, pack, stream, { workspace, id, from: '127.0.0.1', workspaces });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as AddressInfo).port;
  const open = (path: string) => new Promise<IncomingMessage>((done, fail) => request({ port, host: '127.0.0.1', path, agent: false }, done).on('error', fail).end());
  return { l, made, open };
}

/** Read from a stream until what was read holds `want`. */
const until = (res: IncomingMessage, want: RegExp) => new Promise<string>((done) => {
  let read = '';
  const on = (c: Buffer) => { read += c; if (want.test(read)) { res.off('data', on); done(read); } };
  res.on('data', on);
});

test("a pack's page is told when the document it listens to is published again", async (t) => {
  const { l, made, open } = await served(t);
  const res = await open(`/x/reader/live/${l.workspace}/${made.d}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/event-stream');
  await until(res, /: listening/);
  const told = until(res, /event: published\ndata: \d+/);
  await publishedPack.publish(kernelContext(l, 'publish'), human, made.d);
  assert.match(await told, /event: published/);
  res.destroy();
});

test('a document not published, a workspace not there or a stream not declared has no stream', async (t) => {
  const { l, made, open } = await served(t);
  for (const path of [`/x/reader/live/${l.workspace}/${made.draft}`, `/x/reader/live/nowhere/${made.d}`, `/x/reader/other/${l.workspace}/${made.d}`]) {
    const res = await open(path);
    assert.equal(res.statusCode, 404, path);
    res.resume();
  }
});

test("when the pack goes, its pages' streams are closed", async (t) => {
  const { l, made, open } = await served(t);
  const res = await open(`/x/reader/live/${l.workspace}/${made.d}`);
  await until(res, /: listening/);
  const ended = new Promise<void>((done) => res.on('end', done));
  res.resume();
  closeStreams('reader');
  await ended;
});
