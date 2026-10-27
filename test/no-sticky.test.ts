// No request needs the process that began it: two servers on one map answer each other's requests, and a client
// connected over MCP goes on through a deploy with the session it has.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../src/server.ts';
import { Workspaces } from '../src/workspaces.ts';

const closers: (() => Promise<void>)[] = [];
after(async () => {
  for (const close of closers.reverse()) await close();
});

/** One map, and servers on it that share nothing but the database, as two processes would. */
async function oneMap() {
  const root = mkdtempSync(join(tmpdir(), 'pelago-nosticky-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), join(root, 'packs'), { recursive: true });
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(root, 'packs') });
  closers.push(() => workspaces.closeAll());
  const free = async () => {
    const probe = createHttpServer(workspaces, 0);
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const { port } = probe.address() as AddressInfo;
    await new Promise((r) => probe.close(r));
    return port;
  };
  const start = async (port: number) => {
    const server = createHttpServer(workspaces, port);
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    closers.push(() => stop(server));
    return server;
  };
  return { free, start };
}

const stop = (server: Server) =>
  new Promise<void>((r) => {
    server.closeAllConnections();
    server.close(() => r());
  });

const post = async (port: number, path: string, body: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
};

test('a backup link, a refused change and the prompt hook are answered by the other server', async () => {
  const map = await oneMap();
  const [a, b] = [await map.free(), await map.free()];
  await map.start(a);
  await map.start(b);

  const made = (await post(a, '/api/backup_download', {})).json.result;
  const file = await fetch(`http://127.0.0.1:${b}${made.path}`);
  assert.equal(file.status, 200, 'the link made on one server gives the file on the other');
  assert.equal((await fetch(`http://127.0.0.1:${a}${made.path}`)).status, 404, 'and once');

  const refused = (await post(a, '/agent/change', { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'x'.repeat(80) }] })).json.error as string;
  const name = /kept for \d+ minutes as "([^"]+)"/.exec(refused)![1];
  const fixed = await post(b, '/agent/change', { retry: name, fixes: [{ at: 1, op: { op: 'create', type: 'task', title: 'Short' } }] });
  assert.equal(fixed.json.result?.status, 'proposed', 'the change refused by one server is corrected on the other');

  await post(a, '/hooks/session-start', { session_id: 's1' });
  await post(a, '/api/change', { reason: 'the owner decides', ops: [{ op: 'create', type: 'task', title: 'Done by the owner' }] });
  const told = (await post(b, '/hooks/prompt', { session_id: 's1' })).json;
  assert.match(told.hookSpecificOutput?.additionalContext ?? '', /Done by the owner/, 'the other server knows where the session last heard up to');
  assert.deepEqual((await post(a, '/hooks/prompt', { session_id: 's1' })).json, {}, 'and nothing is told twice');
});

test('a client connected over MCP goes on through a deploy with the session it has', async () => {
  const map = await oneMap();
  const port = await map.free();
  const before = await map.start(port);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  closers.push(() => client.close());
  assert.ok((await client.listTools()).tools.some((t) => t.name === 'query'));

  // The deploy: the old server stops, a new one starts in its place.
  await stop(before);
  // Long enough for the client to see its open connections closed, as it would while a deploy takes its minute.
  await new Promise((r) => setTimeout(r, 200));
  await map.start(port);
  const found = await client.callTool({ name: 'query', arguments: { name: 'search', params: { q: 'anything' } } });
  assert.ok(!found.isError, 'the call is answered, without a new session');

  // A client of a server that held sessions in memory carries an id the new one never gave: it is answered all the same.
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': 'given-by-the-old-server', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query', arguments: { name: 'search', params: { q: 'anything' } } } }),
  });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /"result"/);
});
