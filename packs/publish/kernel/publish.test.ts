// The publish pack's pure parts, run without a database: a published page's data and drawing code, where a public item
// is read, and a live page's stream. The whole of publishing against a real map is in test/ (agent-publish, preview,
// public-view, server-published, site, pack-counts), through the shims at src/.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { layoutCode, pageData, publicPath } from './published-data.ts';
import { listen, republished } from './published-live.ts';

const HASH = 'a'.repeat(64);
const doc = { title: 'Doc', parts: [], look: { colors: {} }, lenses: { e_aaaaaaaa: { style: { drawing: { id: 'flow', title: 'Flow', hash: HASH, modules: { 'index.js': 'export {}' } } } } } };

test('a published page is given its drawings by address, never their code, and not its look twice', () => {
  const data = pageData(doc, '/p/ws/e_bbbbbbbb/') as Record<string, unknown> & { lenses: Record<string, { style: { drawing: Record<string, unknown> } }> };
  assert.equal(data.look, undefined);
  assert.equal(data.lenses.e_aaaaaaaa.style.drawing.modules, undefined);
  assert.equal(data.lenses.e_aaaaaaaa.style.drawing.src, `/p/ws/e_bbbbbbbb/drawing/${HASH}`);
});

test('a drawing’s code is found by its hash alone', () => {
  assert.deepEqual(layoutCode(doc, HASH), { 'index.js': 'export {}' });
  assert.equal(layoutCode(doc, 'not-a-hash'), null);
  assert.equal(layoutCode(doc, 'b'.repeat(64)), null);
  assert.equal(publicPath('ws', 'e_aaaaaaaa'), '/p/ws/e_aaaaaaaa');
});

/** A response as a live page's stream is held: what is written to it, and whether it ended. */
function response() {
  const res = Object.assign(new EventEmitter(), {
    written: [] as string[], status: 0, destroyed: false, closed: false, socket: null,
    writeHead(status: number) { res.status = status; return res; },
    write(text: string) { res.written.push(text); return true; },
    end() { res.closed = true; return res; },
  });
  return res;
}

test('a page that listens is told when its document is published again, and only it', () => {
  const mine = response(), other = response();
  listen(mine as never, 'ws', 'e_aaaaaaaa', {}, '203.0.113.9');
  listen(other as never, 'ws', 'e_cccccccc', {}, '203.0.113.9');
  republished('ws', 'e_aaaaaaaa');
  assert.equal(mine.status, 200);
  assert.ok(mine.written.some((w) => w.startsWith('event: published')));
  assert.ok(!other.written.some((w) => w.startsWith('event: published')));
  mine.emit('close');
  other.emit('close');
});
