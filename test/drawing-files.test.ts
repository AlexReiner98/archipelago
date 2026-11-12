// A drawing's modules as files by its hash (src/drawing-files.ts, GET /drawing/<hash>/<module>.js): the same hash and
// text the page is sent, a pack's and the owner's version of it, only as the reader may see it. No browser: that a
// worker imports them is checked by hand (task e_ug3fe57t).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerResponse } from 'node:http';
import { drawingPath } from '../packs/publish/kernel/drawing-files.ts';
import * as drawingFilesPack from '../packs/publish/kernel/drawing-files.ts';
import { drawInside } from '../packs/surface/kernel/ui-files.ts';
import { layoutFor } from '../packs/loader/kernel/layouts.ts';
import { serveDrawingFile } from '../packs/surface/kernel/server-routes.ts';
import { fresh, make } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

/** What a response was written: its status, headers and body. */
function written() {
  const out = { status: 0, headers: {} as Record<string, string>, body: '' };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      Object.assign(out, { status, headers });
      return res;
    },
    end(body?: string) {
      out.body = body ?? '';
      return res;
    },
  };
  return { out, res: res as unknown as ServerResponse };
}

test('a drawing’s modules are served by the hash the page is sent, as the page is sent them', async () => {
  const l = await fresh();
  const drawing = layoutFor(l.registry, { shape: 'map' }, [])!;
  assert.match(drawing.hash, /^[0-9a-f]{64}$/);
  for (const [name, text] of Object.entries(drawing.modules!)) assert.equal(await drawingFilesPack.drawingFile(kernelContext(l, 'publish'), drawing.hash, name), text, name);
  // Its imports stay as they are, so ./x.js resolves beside it.
  assert.match(drawing.modules!['index.js'], /from '\.\/[a-z0-9_-]+\.js'/);
  assert.equal(await drawingFilesPack.drawingFile(kernelContext(l, 'publish'), drawing.hash, 'none-such.js'), null);
  assert.equal(await drawingFilesPack.drawingFile(kernelContext(l, 'publish'), '0'.repeat(64), 'index.js'), null);
  assert.equal(await drawingFilesPack.drawingFile(kernelContext(l, 'publish'), drawing.hash, '../index.js'), null);

  const { out, res } = written();
  await serveDrawingFile(res, `/drawing/${drawing.hash}/index.js`, { tooOften: () => false, reader: async () => l });
  assert.equal(out.status, 200);
  assert.equal(out.body, drawing.modules!['index.js']);
  assert.deepEqual(out.headers, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  });
  for (const path of [`/drawing/${drawing.hash}/nope.js`, `/drawing/${drawing.hash}`, `/drawing/${drawing.hash}/a/index.js`, '/drawing/abc/index.js']) {
    const { out: missing, res: r } = written();
    await serveDrawingFile(r, path, { tooOften: () => false, reader: async () => l });
    assert.equal(missing.status, 404, path);
    assert.equal(missing.body, '', path);
  }
  assert.equal(drawingPath('/drawing/x/index.js'), undefined);
});

test('the owner’s version is served by its own hash, to whoever may see it', async () => {
  const l = await fresh();
  const look = 'export const css = `.lf-step { cursor: help; }`;\n';
  const owner = l.as('e_ownerxx');
  await make(owner, [{ op: 'create', type: 'layout', title: 'Map, mine', visibility: 'private', props: { preset: 'core.map', modules: { 'look.js': look } } }]);
  const { rows } = await l.db.query<{ is_open: boolean; props: Record<string, unknown> }>(`select is_open, props from entity where type = 'layout' limit 5`);
  const mine = layoutFor(l.registry, { shape: 'map' }, rows)!, pack = layoutFor(l.registry, { shape: 'map' }, [])!;
  assert.notEqual(mine.hash, pack.hash);
  assert.equal(await drawingFilesPack.drawingFile(kernelContext(owner, 'publish'), mine.hash, 'look.js'), look);
  assert.equal(await drawingFilesPack.drawingFile(kernelContext(owner, 'publish'), mine.hash, 'index.js'), pack.modules!['index.js']);
  // The pack's own stays served beside it.
  assert.equal(await drawingFilesPack.drawingFile(kernelContext(owner, 'publish'), pack.hash, 'look.js'), pack.modules!['look.js']);
  // Someone the version is not shared with, or anyone with no login, is told nothing of it: the database keeps it from them.
  for (const stranger of [l.as('e_otherxx'), l.forAnyone()]) {
    assert.equal(await drawingFilesPack.drawingFile(kernelContext(stranger, 'publish'), mine.hash, 'look.js'), null);
    assert.equal(await drawingFilesPack.drawingFile(kernelContext(stranger, 'publish'), pack.hash, 'look.js'), pack.modules!['look.js']);
  }
  // Shared with the workspace, a member is served it; public, anyone is.
  const [id] = (await l.db.query<{ id: string }>(`select id from entity where type = 'layout' limit 1`)).rows.map((r) => r.id);
  await make(owner, [{ op: 'update', id, visibility: 'shared' }]);
  assert.equal(await drawingFilesPack.drawingFile(kernelContext((l.as('e_otherxx')), 'publish'), mine.hash, 'look.js'), look);
  assert.equal(await drawingFilesPack.drawingFile(kernelContext((l.forAnyone()), 'publish'), mine.hash, 'look.js'), null);
});

test('a pack’s drawing has a service worker beside its modules; one kept on the map has none', async () => {
  const l = await fresh();
  const pack = layoutFor(l.registry, { shape: 'map' }, [])!;
  const sw = (await drawingFilesPack.drawingWorker(kernelContext(l, 'publish'), pack.hash))!;
  assert.ok(sw.startsWith("import * as made from './index.js';\n" + (await drawInside())));
  assert.ok(sw.endsWith('\ninside(null, made);\n'));
  const { out, res } = written();
  await serveDrawingFile(res, `/drawing/${pack.hash}/sw.js`, { tooOften: () => false, reader: async () => l });
  assert.equal(out.status, 200);
  assert.equal(out.body, sw);
  assert.equal(out.headers['cache-control'], 'no-cache');
  assert.equal(out.headers['content-security-policy'], "default-src 'none'; script-src 'self'");
  // The owner's version is code from the map: the frame draws it in a worker it can stop.
  await make(l, [{ op: 'create', type: 'layout', title: 'Map, mine', props: { preset: 'core.map', modules: { 'look.js': 'export const css = ``;\n' } } }]);
  const { rows } = await l.db.query<{ is_open: boolean; props: Record<string, unknown> }>(`select is_open, props from entity where type = 'layout' limit 5`);
  const mine = layoutFor(l.registry, { shape: 'map' }, rows)!;
  assert.ok(await drawingFilesPack.drawingFile(kernelContext(l, 'publish'), mine.hash, 'index.js'));
  assert.equal(await drawingFilesPack.drawingWorker(kernelContext(l, 'publish'), mine.hash), null);
  const { out: none, res: r } = written();
  await serveDrawingFile(r, `/drawing/${mine.hash}/sw.js`, { tooOften: () => false, reader: async () => l });
  assert.deepEqual([none.status, none.body], [404, '']);
});

test('a pack’s drawing is served past the open limit, all its modules at once; a hash not the packs’ is counted', async () => {
  const l = await fresh();
  const pack = layoutFor(l.registry, { shape: 'map' }, [])!;
  // A limit already reached: tooOften answers 429 itself, as the server's does, and says so.
  let counted = 0;
  const limited = (res: ServerResponse) => () => (counted++, res.writeHead(429, {}).end(), true);
  for (const name of ['sw.js', 'index.js', 'look.js']) {
    const { out, res } = written();
    await serveDrawingFile(res, `/drawing/${pack.hash}/${name}`, { tooOften: limited(res), reader: async () => l });
    assert.equal(out.status, 200, name);
  }
  assert.equal(counted, 0);
  const { out, res } = written();
  await serveDrawingFile(res, `/drawing/${'0'.repeat(64)}/index.js`, { tooOften: limited(res), reader: async () => l });
  assert.deepEqual([out.status, counted], [429, 1]);
});
