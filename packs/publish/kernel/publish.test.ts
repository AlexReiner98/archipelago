// The publish pack's pure parts, run without a database: a published page's data and drawing code, where a public item
// is read, and a live page's stream. The whole of publishing against a real map is in test/ (agent-publish, preview,
// public-view, server-published, site, pack-counts), through the shims at src/.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { layoutCode, pageData, publicPath } from './published-data.ts';
import { listen, republished } from './published-live.ts';
import { countsSince } from './pack-counts.ts';
import { siteNav } from './site.ts';
import type { KernelContext } from '#pelago/kernel';

/** A context whose reads answer by their key from what is given, and say each read asked. */
const fake = (answers: Record<string, unknown>, asked: Record<string, unknown>[] = []) => ({ reads: async (q: Record<string, unknown>) => (asked.push(q), answers[Object.keys(q)[0]]) }) as unknown as KernelContext;

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

test('a site is its public views: the menu in order, home apart, and the footer as published', async () => {
  const views = [
    { id: 'e_home0000', title: 'Home', path: 'home', menu: 0 },
    { id: 'e_about000', title: 'About', path: 'about', menu: 1 },
    { id: 'e_hidden00', title: 'Unlisted', path: 'unlisted', menu: null },
    { id: 'e_foot0000', title: 'Footer', path: 'footer', menu: null },
  ];
  const asked: Record<string, unknown>[] = [];
  const nav = await siteNav(fake({ public_views: views, public_view_at: { parts: [{ text: 'One' }, { figure: 1 }, { text: 'Two' }] } }, asked), 'Acme', (p) => `/${p.path}`);
  assert.deepEqual(nav, { footer: 'One\n\nTwo', name: 'Acme', home: '/home', pages: [{ title: 'About', href: '/about' }] });
  assert.deepEqual(asked, [{ public_views: true }, { public_view_at: 'footer' }]);
  const bare = await siteNav(fake({ public_views: [] }), 'Acme', () => null);
  assert.deepEqual(bare, { name: 'Acme', home: null, pages: [] }, 'no footer read when none is published');
});

test('counts are summed per key per day after a position, whole entries only', async () => {
  const entries = [
    { pos: 4, facts: [['+', 'key:home', '2026-11-11', 2], ['+', 'e_notakey', '2026-11-11', 9]] },
    { pos: 5, facts: [['+', 'key:home', '2026-11-11', 1], ['+', 'key:docs', '2026-11-12', 3]] },
  ];
  const asked: Record<string, unknown>[] = [];
  const read = await countsSince(fake({ counts: entries }, asked), 'visits', 3);
  assert.deepEqual(read, { counts: [{ key: 'home', day: '2026-11-11', n: 3 }, { key: 'docs', day: '2026-11-12', n: 3 }], pos: 5 });
  assert.deepEqual(asked, [{ counts: { stream: 'visits', after: 3 } }]);
  assert.deepEqual(await countsSince(fake({ counts: [] }), 'visits', 7), { counts: [], pos: 7 });
});
