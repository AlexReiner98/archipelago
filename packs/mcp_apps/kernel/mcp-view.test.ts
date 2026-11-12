// The page a chat draws a view in, run without a server: only draw names it, and its policy lets only its own script
// run. A host drawing it is test/mcp-view-host.test.ts; the server offering it, test/mcp-view.test.ts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { registerView, toolView, VIEW_TYPE, VIEW_URI, viewPage } from './mcp-view.ts';

test('only draw names the page', () => {
  assert.deepEqual(toolView('draw'), { _meta: { ui: { resourceUri: VIEW_URI } } });
  assert.deepEqual(toolView('query'), {});
});

test('the page runs its own script alone, and reaches nothing', () => {
  const page = viewPage();
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? '';
  assert.ok(page.includes(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`));
  assert.ok(page.includes("connect-src 'none'"));
  assert.ok(!page.includes('{{policy}}'));
});

test('a request’s server is offered the page as one resource', async () => {
  const offered: { name: string; uri: string; read: () => Promise<{ contents: { mimeType: string }[] }> }[] = [];
  registerView({ registerResource: (name, uri, _meta, read) => offered.push({ name, uri, read }) });
  assert.deepEqual(offered.map((o) => [o.name, o.uri]), [['view', VIEW_URI]]);
  const { contents } = await offered[0].read();
  assert.equal(contents[0].mimeType, VIEW_TYPE);
});
