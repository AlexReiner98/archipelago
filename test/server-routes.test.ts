import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { READER_POLICY } from '../packs/walls/kernel/public-document.ts';
import { serve } from './serve.ts';

before(() => Object.assign(process.env, { PELAGO_SERVER_PACKS: join(import.meta.dirname, 'server-packs', 'made') }));
after(() => delete process.env.PELAGO_SERVER_PACKS);

test('an entry that answers html makes a page per request, sent under the reader’s policy with headers the kernel sets', async () => {
  const { base } = await serve('off');
  const page = await fetch(`${base}/x/page/hello?name=<Rosa>`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-security-policy'), READER_POLICY);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(page.headers.get('set-cookie'), null, 'a pack sets no header');
  assert.match(await page.text(), /<h1>Hello, &lt;Rosa><\/h1>/);
  assert.equal((await fetch(`${base}/x/page/public/page.css`)).headers.get('content-type'), 'text/css');

  const gone = await fetch(`${base}/x/page/gone`);
  assert.deepEqual([gone.status, gone.headers.get('cache-control'), await gone.text()], [410, 'no-store', '<p>Gone</p>']);

  // What the kernel will not send is a plain page saying so, under no policy but none.
  for (const name of ['teapot', 'huge', 'nohtml']) {
    const r = await fetch(`${base}/x/page/${name}`);
    assert.equal(r.status, 500, name);
    assert.equal(r.headers.get('content-security-policy'), "default-src 'none'", name);
    assert.match(await r.text(), /could not be made/, name);
  }
  const failed = await fetch(`${base}/x/page/throws`);
  assert.equal(failed.status, 500);
  assert.match(await failed.text(), /No &lt;such> page/);
  assert.equal((await fetch(`${base}/x/page/hello`, { method: 'POST', body: '{}' })).status, 404, 'a page is only got');
  assert.equal((await fetch(`${base}/x/page/hello/more`)).status, 404);
});
