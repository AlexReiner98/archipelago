import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { serve } from './serve.ts';

/** A GET as a browser at another domain sends it: the same server, a different Host. */
function visit(base: string, path: string, host: string) {
  const { hostname, port } = new URL(base);
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    request({ hostname, port, path, headers: { host } }, (res) => {
      let body = '';
      res.setEncoding('utf8').on('data', (c) => (body += c)).on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    }).on('error', reject).end();
  });
}

test('a domain serves a workspace’s published pages at their address words, the front page at /', async () => {
  const { call, base } = await serve('off', undefined, { 'site.test': 'default' });
  const { home, a, b, d } = (
    await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'home', type: 'document', title: 'Welcome', visibility: 'shared', props: { path: 'home', menu: 0 }, body: 'The front page. Read {a}.' },
        { op: 'create', ref: 'a', type: 'document', title: 'How it works', visibility: 'shared', props: { path: 'how-it-works', menu: 1 }, body: 'How it works, in short. Back to {home}.' },
        { op: 'create', ref: 'b', type: 'document', title: 'Not in the header', visibility: 'shared', props: { path: 'aside' }, body: 'An aside.' },
        { op: 'create', ref: 'd', type: 'document', title: 'A draft', visibility: 'shared', props: { path: 'draft' }, body: 'Not published.' },
      ],
    })
  ).result.created;
  for (const id of [home, a, b, home, a]) assert.equal((await call('/api/publish', undefined, { id })).status, 200);

  // The front page, at / only.
  const front = await visit(base, '/', 'site.test');
  assert.equal(front.status, 200);
  assert.match(front.body, /<title>Welcome<\/title>/);
  assert.match(front.body, /<link rel="canonical" href="https:\/\/site\.test\/" \/>/);
  assert.match(front.body, /<meta property="og:url" content="https:\/\/site\.test\/" \/>/);
  assert.match(front.body, /<meta property="og:site_name" content="Default" \/>/);
  assert.equal((await visit(base, '/home', 'site.test')).headers.location, '/');
  const frontData = JSON.parse((await visit(base, '/data', 'site.test')).body);
  assert.equal(frontData.title, 'Welcome');
  assert.deepEqual(frontData.paths, { [a]: 'how-it-works' });

  // A page at its address word, its header listing what has a place in the menu, the front page apart.
  const page = JSON.parse((await visit(base, '/how-it-works/data', 'site.test')).body);
  assert.equal(page.title, 'How it works');
  assert.deepEqual(page.site, { name: 'Default', home: '/', pages: [{ title: 'How it works', href: '/how-it-works' }], host: 'site.test' });
  assert.deepEqual(page.paths, { [home]: 'home' });
  assert.match((await visit(base, '/how-it-works', 'site.test')).body, /<link rel="canonical" href="https:\/\/site\.test\/how-it-works" \/>/);

  // Search engines are told every page; nothing unpublished is there to find.
  const map = (await visit(base, '/sitemap.xml', 'site.test')).body;
  for (const loc of ['https://site.test/', 'https://site.test/how-it-works', 'https://site.test/aside']) assert.ok(map.includes(`<loc>${loc}</loc>`), loc);
  assert.ok(!map.includes('draft'));
  assert.match((await visit(base, '/robots.txt', 'site.test')).body, /Sitemap: https:\/\/site\.test\/sitemap\.xml/);
  assert.equal((await visit(base, '/draft', 'site.test')).status, 404);
  assert.equal((await visit(base, '/draft/data', 'site.test')).status, 404);

  // Its /p/ address points search engines at the domain's, and carries the same header with /p/ addresses.
  assert.match((await visit(base, `/p/default/${a}`, `127.0.0.1:${new URL(base).port}`)).body, /<link rel="canonical" href="https:\/\/site\.test\/how-it-works" \/>/);
  const viaP = (await (await fetch(`${base}/p/default/${a}/data`)).json()) as { site: { pages: { href: string }[] } };
  assert.deepEqual(viaP.site.pages, [{ title: 'How it works', href: `/p/default/${a}` }]);

  // The page's own scripts are served on the domain as everywhere.
  assert.equal((await visit(base, '/doc.js', 'site.test')).status, 200);
  void d;
});

test('everything a project holds is published with one click, an agent may only ask for it', async () => {
  const { call, base } = await serve('off');
  const made = (
    await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'P', type: 'project', title: 'The site', visibility: 'shared' },
        { op: 'create', ref: 'S', type: 'note', title: 'A part of it', visibility: 'shared' },
        { op: 'create', ref: 'a', type: 'document', title: 'Alpha', visibility: 'shared', props: { path: 'alpha' }, body: 'Alpha. See {b}.' },
        { op: 'create', ref: 'b', type: 'document', title: 'Beta', visibility: 'shared', props: { path: 'beta' }, body: 'Beta. Back to {a}.' },
        { op: 'create', ref: 'd', type: 'document', title: 'Deeper', visibility: 'shared', props: { path: 'deeper' }, body: 'Held a step down.' },
        { op: 'create', ref: 'c', type: 'document', title: 'Withdrawn', status: 'withdrawn', visibility: 'shared', body: 'Not published.' },
        { op: 'create', ref: 'x', type: 'document', title: 'Taken', visibility: 'shared', props: { path: 'alpha' }, body: 'Its path is taken.' },
        { op: 'link', type: 'part_of', from: 'a', to: 'P' },
        { op: 'link', type: 'part_of', from: 'b', to: 'P' },
        { op: 'link', type: 'part_of', from: 'S', to: 'P' },
        { op: 'link', type: 'part_of', from: 'd', to: 'S' },
        { op: 'link', type: 'part_of', from: 'c', to: 'P' },
        { op: 'link', type: 'part_of', from: 'x', to: 'P' },
      ],
    })
  ).result.created;
  const { P, a, b, c, x } = made;
  const plan = (await call('/api/publish_plan', undefined, { within: P })).result;
  assert.equal(plan.to_publish, 4, 'every open document, at any depth');
  assert.ok(!plan.documents.some((doc: { id: string }) => doc.id === c), 'what is closed is left out');

  // An agent asks: the person is told, and nothing is published.
  const asked = (await call('/agent/publish_ask', undefined, { within: P, reason: 'The docs are ready.' })).result;
  assert.deepEqual([asked.asked, asked.to_publish], [true, 4]);
  assert.notEqual((await call('/agent/publish_all', undefined, { within: P })).status, 200, 'only a person publishes');
  assert.equal((await fetch(`${base}/p/default/${a}/data`)).status, 404);

  // One click: all of it, each linking to the others; the one whose path is taken is named, the rest go ahead.
  const done = (await call('/api/publish_all', undefined, { within: P })).result;
  assert.deepEqual(done.published.map((doc: { title: string }) => doc.title).sort(), ['Alpha', 'Beta', 'Deeper']);
  assert.deepEqual(done.refused.map((doc: { id: string }) => doc.id), [x]);
  const alpha = (await (await fetch(`${base}/p/default/${a}/data`)).json()) as { links: Record<string, string>; paths: Record<string, string> };
  assert.deepEqual([alpha.links[b], alpha.paths[b]], ['Beta', 'beta'], 'published twice, so the first links to the second');
  assert.equal((await call('/api/publish_plan', undefined, { within: P })).result.to_publish, 1, 'only the refused one is left');
});

test('a path must be an address word, and one published path belongs to one document', async () => {
  const { call } = await serve('off');
  const { x, y, z } = (
    await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'x', type: 'document', title: 'First', visibility: 'shared', props: { path: 'guide' }, body: 'One.' },
        { op: 'create', ref: 'y', type: 'document', title: 'Second', visibility: 'shared', props: { path: 'guide' }, body: 'Two.' },
        { op: 'create', ref: 'z', type: 'document', title: 'Third', visibility: 'shared', props: { path: 'Not A Path' }, body: 'Three.' },
      ],
    })
  ).result.created;
  assert.equal((await call('/api/publish', undefined, { id: x })).status, 200);
  assert.match((await call('/api/publish', undefined, { id: y })).error, /"First" is already published at \/guide/);
  assert.match((await call('/api/publish', undefined, { id: z })).error, /cannot be an address/);
  assert.equal((await call('/api/get', undefined, { id: z })).result.entity.visibility, 'shared', 'refused before it was made public');
});

test('a site’s pages each end with what its footer page says, and the sitemap leaves the footer out', async () => {
  const { call, base } = await serve('off', undefined, { 'site.test': 'default' });
  const { home, foot } = (
    await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'home', type: 'document', title: 'Welcome', visibility: 'shared', props: { path: 'home' }, body: 'The front page.' },
        { op: 'create', ref: 'foot', type: 'document', title: 'Footer', visibility: 'shared', props: { path: 'footer' }, body: 'Made in Canada. Questions: hello@example.com.' },
      ],
    })
  ).result.created;
  assert.equal((await call('/api/publish', undefined, { id: home })).status, 200);
  assert.equal(JSON.parse((await visit(base, '/data', 'site.test')).body).site.footer, undefined, 'none before it is published');
  assert.equal((await call('/api/publish', undefined, { id: foot })).status, 200);
  assert.equal(JSON.parse((await visit(base, '/data', 'site.test')).body).site.footer, 'Made in Canada. Questions: hello@example.com.');
  assert.ok(!(await visit(base, '/sitemap.xml', 'site.test')).body.includes('/footer'));
});
