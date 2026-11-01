// The view drawn inline (src/mcp-view.ts, ui/mcp-view.html), in a real browser under a host of this test's own: an
// iframe with no origin of its own, given the page as the MCP endpoint serves it, spoken to over postMessage as the
// extension says, with the host's own token kept on the host's side. Not a real client: what one does is on the task.
// Skipped where there is no Chrome.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createToken } from '../src/auth.ts';
import { stopLayout } from '../src/look-draw.ts';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

after(stopLayout);

/** A host: it frames the page, answers its handshake, tells it of one call, and proxies its tools/call to /mcp. */
const HOST = (html: string, mcp: string, token: string, input: unknown, context: unknown) => `(() => {
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-scripts';
  frame.style = 'width: 640px; height: 600px; border: 0';
  frame.srcdoc = ${JSON.stringify(html)};
  const said = (window.said = { sizes: [], calls: [], initialized: false });
  const to = (m) => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...m }, '*');
  addEventListener('message', async (ev) => {
    if (ev.source !== frame.contentWindow) return;
    const { id, method, params } = ev.data;
    if (method === 'ui/initialize') return to({ id, result: { protocolVersion: '2026-01-26', hostCapabilities: { serverTools: {} }, hostInfo: { name: 'test', version: '1' }, hostContext: ${JSON.stringify(context)} } });
    if (method === 'ui/notifications/initialized') {
      said.initialized = true;
      to({ method: 'ui/notifications/tool-input', params: { arguments: ${JSON.stringify(input)} } });
      return to({ method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: '{}' }] } });
    }
    if (method === 'ui/notifications/size-changed') return said.sizes.push(params);
    if (method === 'tools/call') {
      said.calls.push(params);
      const res = await fetch(${JSON.stringify(mcp)}, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ${token}' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const data = /^data: (.*)$/m.exec(await res.text())[1];
      to({ id, result: JSON.parse(data).result });
    }
  });
  document.body.replaceChildren(frame);
})()`;

test('in a browser, the page draws a flow from the look it asks the host for, and stays shut for what is no view', { skip: !chrome() && 'no Chrome here (set CHROME)' }, async () => {
  const { workspaces, base, call } = await serve('tokens');
  const pelago = (await workspaces.get('default')).pelago;
  const { token } = await createToken(pelago.db, 'default', { kind: 'agent', name: 'chat' });
  const client = new Client({ name: 'test-host', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const owner = (await createToken(pelago.db, 'default', { kind: 'human', name: 'owner', admin: true })).token;
  const made = (await call('/api/change', owner, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'task', title: 'Second step' },
      { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    ],
  })).result.created as Record<string, string>;
  const view = (await call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', ref: 'f', type: 'lens', title: 'The steps', status: 'current', props: { filter: { find: [`id ${made.a}`] }, walk: { over: ['depends_on'], steps: 1 } } }] })).result.created.f as string;
  const html = ((await client.readResource({ uri: 'ui://pelago/view' })).contents[0] as { text: string }).text;

  const page = await open(`${base}/health`);
  // The frame runs in a process of its own (Chrome isolates a sandboxed frame): reached through a session of its own.
  const frameSees = async (expression: string) => {
    const targets = (await page.send('Target.getTargets')).result.targetInfos as { targetId: string; type: string }[];
    const session = (await page.send('Target.attachToTarget', { targetId: targets.findLast((t) => t.type === 'iframe')!.targetId, flatten: true })).result.sessionId;
    return (await page.send('Runtime.evaluate', { expression, returnByValue: true }, session)).result?.result?.value;
  };
  const until = async (expression: string, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await frameSees(expression).catch(() => false)) return true;
    return false;
  };
  try {
    await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    // A call that is no view: the page stays shut, and asks nothing.
    await page.evaluate(HOST(html, `${base}/mcp`, token, { name: 'get', params: { id: made.a } }, { theme: 'light' }));
    assert.ok(await page.evaluate<boolean>(`new Promise((r) => { const t = setInterval(() => window.said.initialized && (clearInterval(t), r(true)), 50); })`));
    await new Promise((r) => setTimeout(r, 400));
    const shut = await page.evaluate<{ sizes: { height: number }[]; calls: unknown[] }>('window.said');
    assert.deepEqual(shut.calls, []);
    assert.ok(shut.sizes.every((s) => s.height === 0), JSON.stringify(shut.sizes));

    // A show of a kept view: the page asks the host for a look, and mounts the marks.
    await page.go(`${base}/health`);
    await page.evaluate(HOST(html, `${base}/mcp`, token, { action: 'show', params: { entity: view, note: 'The steps' } }, { theme: 'light', containerDimensions: { width: 640, maxHeight: 600 }, availableDisplayModes: ['inline', 'fullscreen'] }));
    assert.ok(await until(`Boolean(document.querySelector('#view svg text'))`), `the drawing is mounted: ${JSON.stringify([await page.logs(), await page.evaluate('window.said'), await frameSees(`document.body.innerHTML.slice(0, 500)`).catch((e: Error) => String(e))])}`);
    const seen = await frameSees(`({ words: document.querySelector('#view').textContent, drawing: document.querySelector('#view').dataset.drawing, scripts: document.querySelectorAll('#view script').length })`);
    assert.match(seen.words, /First step/);
    assert.match(seen.words, /Second step/);
    assert.ok(seen.drawing);
    assert.equal(seen.scripts, 0);
    const said = await page.evaluate<{ sizes: { height: number }[]; calls: { name: string; arguments: { name: string; params: Record<string, unknown> } }[] }>('window.said');
    assert.deepEqual(said.calls.map((c) => [c.name, c.arguments.name]), [['query', 'look']]);
    assert.deepEqual(said.calls[0].arguments.params, { entity: view, width: 640, height: 600, scheme: 'light', marks: true });
    assert.ok(said.sizes.at(-1)!.height > 0, 'the host is told how tall it is');
    // Nothing the policy refuses was tried.
    assert.deepEqual((await page.logs()).filter((line) => /Content Security Policy/i.test(line)), []);
  } finally {
    await page.close();
    await client.close();
  }
});
