// A view drawn inline in a chat (src/mcp-view.ts, the MCP Apps extension): what a client is offered through the MCP
// endpoint. The page itself, in a browser under a host of a test's own, is test/mcp-view-host.test.ts.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createToken } from '../src/auth.ts';
import { serve } from './serve.ts';

const URI = 'ui://pelago/view';
const TYPE = 'text/html;profile=mcp-app';

async function connected() {
  const { workspaces, base } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const { token } = await createToken(db, 'default', { kind: 'agent', name: 'chat' });
  const client = new Client({ name: 'test-host', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return { client, token };
}

test('query and report name the view, and the server says it speaks the extension', async () => {
  const { client } = await connected();
  assert.deepEqual(client.getServerCapabilities()?.extensions?.['io.modelcontextprotocol/ui'], { mimeTypes: [TYPE] });
  const { tools } = await client.listTools();
  const named = tools.filter((t) => t._meta?.ui).map((t) => [t.name, (t._meta?.ui as { resourceUri: string }).resourceUri]);
  assert.deepEqual(named, [['query', URI], ['report', URI]]);
  await client.close();
});

test('the view is listed and read through the endpoint: its type, its policy, no token and nothing it could fetch', async () => {
  const { client, token } = await connected();
  const { resources } = await client.listResources();
  assert.deepEqual(resources.filter((r) => r.uri === URI).map((r) => r.mimeType), [TYPE]);

  const { contents } = await client.readResource({ uri: URI });
  assert.equal(contents.length, 1);
  const [read] = contents as [{ uri: string; mimeType: string; text: string; _meta: { ui: { csp: Record<string, string[]> } } }];
  assert.equal(read.uri, URI);
  assert.equal(read.mimeType, TYPE);
  assert.match(read.text, /^<!doctype html>/i);

  // The host is told it reaches nothing.
  assert.deepEqual(read._meta.ui.csp, { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] });

  // The page says so itself, whatever the host allows: only the script it holds runs, by its hash.
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(read.text)?.[1] ?? '';
  const says = Object.fromEntries(policy.split('; ').map((d) => [d.slice(0, d.indexOf(' ')), d.slice(d.indexOf(' ') + 1)]));
  const script = /<script>([\s\S]*?)<\/script>/.exec(read.text)?.[1] ?? '';
  assert.deepEqual(says, {
    'default-src': "'none'",
    'script-src': `'sha256-${createHash('sha256').update(script).digest('base64')}'`,
    'style-src': "'unsafe-inline'",
    'img-src': 'data:',
    'connect-src': "'none'",
    'frame-src': "'none'",
    'base-uri': "'none'",
    'form-action': "'none'",
  });
  assert.equal([...read.text.matchAll(/<script\b/g)].length, 1, 'one script, the one the policy names');

  // It holds no token and no address, and calls nothing but the host.
  assert.ok(!read.text.includes(token));
  assert.doesNotMatch(read.text, /Bearer|authorization|pelago-token|https?:\/\//i);
  assert.doesNotMatch(read.text, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|Worker)\b/);
  assert.doesNotMatch(read.text, /localStorage|sessionStorage|document\.cookie/);
  await client.close();
});

test('a tool answers a client as it did: words, and nothing for a view', async () => {
  const { client } = await connected();
  const answer = await client.callTool({ name: 'query', arguments: { name: 'schema' } });
  assert.equal(answer._meta, undefined);
  assert.equal(answer.structuredContent, undefined);
  assert.deepEqual((answer.content as { type: string }[]).map((c) => c.type), ['text']);
  await client.close();
});
