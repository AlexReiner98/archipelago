// A site's home view baked (src/public-bake.ts, packs/reader/baked-site.js): where the view at /home is drawn by the
// rails, / is one page of its stops' words and the map as SVG, each stop at its own address, JSON for an agent, and
// nothing private on any of it.

import assert from 'node:assert/strict';
import { request } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { serve } from './serve.ts';

/** A pack with a document the kernel can publish: core keeps none of its own (test/fixtures/packs/pages). */
const PAGES = [join(import.meta.dirname, 'fixtures', 'packs')];

function visit(base: string, path: string, host: string, accept?: string) {
  const { hostname, port } = new URL(base);
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    request({ hostname, port, path, headers: { host, ...(accept && { accept }) } }, (res) => {
      let body = '';
      res.setEncoding('utf8').on('data', (c) => (body += c)).on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    }).on('error', reject).end();
  });
}

test('a home view drawn by the rails is baked at /: its stops in order, each at its own address, nothing private', async () => {
  const { call, base } = await serve('off', undefined, { 'site.test': 'default' }, PAGES);
  const made = (
    await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'a', type: 'task', title: 'Map the work', body: 'Every piece of work is an item.', visibility: 'shared' },
        { op: 'create', ref: 'b', type: 'task', title: 'Say who waits', body: 'A link <b>says</b> who waits.', visibility: 'shared' },
        { op: 'create', ref: 'p', type: 'task', title: 'A secret plan', body: 'Only mine.', visibility: 'private' },
        { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
        { op: 'link', type: 'depends_on', from: 'p', to: 'b' },
        { op: 'create', ref: 'l', type: 'lens', title: 'The walk', visibility: 'shared', props: { filter: { find: ['type task'] }, style: { shape: 'rails' } } },
        { op: 'create', ref: 'home', type: 'page', title: 'Archipelago', visibility: 'shared', props: { path: 'home' }, body: '{hero}\n\n{l}' },
        { op: 'create', ref: 'hero', type: 'plate', title: 'A map of the work', visibility: 'shared', body: '' },
        { op: 'link', type: 'part_of', from: 'hero', to: 'home' },
        { op: 'link', type: 'part_of', from: 'l', to: 'home' },
      ],
    })
  ).result.created as Record<string, string>;
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
  assert.equal((await call('/api/picture_put', undefined, { result: made.hero, data: png, content_type: 'image/png' })).status, 200);
  assert.equal((await call('/api/publish', undefined, { id: made.home })).status, 200);

  const front = await visit(base, '/', 'site.test');
  assert.equal(front.status, 200);
  assert.match(front.body, /<section class="rails" data-whole="[\d. ]+"/);
  assert.match(front.body, /<svg [^>]*viewBox/, 'the map as SVG');
  // Each stop's title and note as text, in the walk's order; the note's words escaped.
  const at = (s: string) => front.body.indexOf(s);
  assert.ok(at(`id="s-${made.a}"`) > 0 && at(`id="s-${made.a}"`) < at(`id="s-${made.b}"`), 'what a stop rests on comes first');
  assert.ok(front.body.includes('<h2>Map the work</h2><p>Every piece of work is an item.</p>'));
  assert.ok(front.body.includes('A link &#60;b&#62;says&#60;/b&#62; who waits.'));
  for (const word of ['secret plan', 'Only mine', made.p]) assert.ok(!front.body.includes(word), `nothing private: ${word}`);
  // The site's policy holds: no script or style written in the page.
  assert.match(String(front.headers['content-security-policy']), /script-src 'self'/);
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(front.body) && !/<style/.test(front.body) && !/ style="/.test(front.body));
  assert.match(front.body, /<a class="start" href="\/go\/start">/);

  // The hero above the walk, its picture the one kept with the view.
  const hero = front.body.indexOf(`<img src="/picture/${made.hero}" alt="A map of the work" />`);
  assert.ok(hero > 0 && hero < front.body.indexOf('<section class="rails"'));
  assert.equal((await visit(base, `/picture/${made.hero}`, 'site.test')).status, 200);

  // A stop at its own address: the same page, its head the stop's.
  const stop = await visit(base, `/${made.b}`, 'site.test');
  assert.equal(stop.status, 200);
  assert.match(stop.body, new RegExp(`<link rel="canonical" href="https://site\\.test/${made.b}" />`));
  assert.match(stop.body, /<title>Say who waits · Default<\/title>/);
  assert.match(stop.body, new RegExp(`data-start="${made.b}"`));
  assert.equal((await visit(base, `/${made.p}`, 'site.test')).status, 404, 'a private item is no stop');
  assert.equal((await visit(base, `/go/seen/${made.p}`, 'site.test')).status, 404);
  assert.equal((await visit(base, `/go/seen/${made.a}?ref=hn`, 'site.test')).status, 200);

  // An agent asking for JSON is given the stops and the install line.
  const json = JSON.parse((await visit(base, '/', 'site.test', 'application/json')).body);
  assert.deepEqual(json.stops.map((s: { id: string }) => s.id), [made.a, made.b]);
  assert.equal(json.stops[0].href, `https://site.test/${made.a}`);
  assert.match(json.install, /\/connect\/install/);

  // Its own stylesheet holds the style's values and the drawing's sheet; its scripts are the reader's.
  const look = await visit(base, '/look.css', 'site.test');
  assert.match(String(look.headers['content-type']), /^text\/css/);
  assert.match(look.body, /--ln-rails-stop-span: \d+px;/);
  assert.match(look.body, /\.rails \{/);
  assert.match(String((await visit(base, '/rails.js', 'site.test')).headers['content-type']), /^text\/javascript/);

  // The main button is counted, then leads to the app, carrying the tag.
  const start = await visit(base, '/go/start?ref=hn', 'site.test');
  assert.equal(start.status, 302);
  assert.match(String(start.headers.location), /\?ref=hn$/);
});

test('a home view not drawn by the rails is the page it was', async () => {
  const { call, base } = await serve('off', undefined, { 'site.test': 'default' }, PAGES);
  const { home } = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'home', type: 'page', title: 'Welcome', visibility: 'shared', props: { path: 'home' }, body: 'Hello.' }] })).result.created;
  assert.equal((await call('/api/publish', undefined, { id: home })).status, 200);
  const front = await visit(base, '/', 'site.test');
  assert.equal(front.status, 200);
  assert.ok(!front.body.includes('class="rails"'));
  assert.equal((await visit(base, '/look.css', 'site.test')).status, 404);
});
