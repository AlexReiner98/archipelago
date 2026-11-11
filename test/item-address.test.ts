import assert from 'node:assert/strict';
import { test } from 'node:test';
import { itemAddress } from '../src/item-address.ts';
import { serve } from './serve.ts';

test('an item address is sent to the page, which opens its workspace on the item', () => {
  assert.equal(itemAddress('/i/acme/e_abc12345'), '/?link=acme#/e/e_abc12345');
  assert.equal(itemAddress('/i/my-ws-2/e_0a1b2c3d/'), '/?link=my-ws-2#/e/e_0a1b2c3d');
  // Not one at all: left to whatever else answers it.
  for (const path of ['/', '/items/acme/e_abc12345', '/is', '/mcp/acme']) assert.equal(itemAddress(path), undefined, path);
  // Malformed: no workspace an MCP address names, no item id, or more after it.
  for (const path of ['/i', '/i/', '/i/acme', '/i/acme/e_abc', '/i/acme/e_ABC12345', '/i/acme/e_abc123456', '/i/Acme/e_abc12345', '/i/-acme/e_abc12345', '/i/acme/e_abc12345/more', '/i//e_abc12345', `/i/${'a'.repeat(41)}/e_abc12345`]) assert.equal(itemAddress(path), null, path);
});

test('GET /i/<workspace>/<item> redirects with no token asked, and anything malformed is not found', async () => {
  const { base } = await serve('tokens');
  const r = await fetch(`${base}/i/acme/e_abc12345`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/?link=acme#/e/e_abc12345');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  for (const path of ['/i/acme', '/i/acme/nope', '/i/ACME/e_abc12345', '/i/acme/e_abc12345/x']) assert.equal((await fetch(`${base}${path}`, { redirect: 'manual' })).status, 404, path);
  // Only a GET is sent on.
  assert.notEqual((await fetch(`${base}/i/acme/e_abc12345`, { method: 'POST', redirect: 'manual' })).status, 302);
});
