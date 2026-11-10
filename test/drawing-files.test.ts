// A drawing's modules as files by its hash (src/drawing-files.ts, GET /drawing/<hash>/<module>.js): the same hash and
// text the page is sent, a pack's and the owner's version of it, only as the reader may see it. No browser: that a
// worker imports them is checked by hand (task e_ug3fe57t).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerResponse } from 'node:http';
import { drawingFile, drawingPath } from '../src/drawing-files.ts';
import { layoutFor } from '../src/layouts.ts';
import { serveDrawingFile } from '../src/server-routes.ts';
import { fresh, make } from './map.ts';

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
  for (const [name, text] of Object.entries(drawing.modules!)) assert.equal(await drawingFile(l, drawing.hash, name), text, name);
  // Its imports stay as they are, so ./x.js resolves beside it.
  assert.match(drawing.modules!['index.js'], /from '\.\/[a-z0-9_-]+\.js'/);
  assert.equal(await drawingFile(l, drawing.hash, 'none-such.js'), null);
  assert.equal(await drawingFile(l, '0'.repeat(64), 'index.js'), null);
  assert.equal(await drawingFile(l, drawing.hash, '../index.js'), null);

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
  assert.equal(await drawingFile(owner, mine.hash, 'look.js'), look);
  assert.equal(await drawingFile(owner, mine.hash, 'index.js'), pack.modules!['index.js']);
  // The pack's own stays served beside it.
  assert.equal(await drawingFile(owner, pack.hash, 'look.js'), pack.modules!['look.js']);
  // Someone the version is not shared with, or anyone with no login, is told nothing of it: the database keeps it from them.
  for (const stranger of [l.as('e_otherxx'), l.forAnyone()]) {
    assert.equal(await drawingFile(stranger, mine.hash, 'look.js'), null);
    assert.equal(await drawingFile(stranger, pack.hash, 'look.js'), pack.modules!['look.js']);
  }
  // Shared with the workspace, a member is served it; public, anyone is.
  const [id] = (await l.db.query<{ id: string }>(`select id from entity where type = 'layout' limit 1`)).rows.map((r) => r.id);
  await make(owner, [{ op: 'update', id, visibility: 'shared' }]);
  assert.equal(await drawingFile(l.as('e_otherxx'), mine.hash, 'look.js'), look);
  assert.equal(await drawingFile(l.forAnyone(), mine.hash, 'look.js'), null);
});
