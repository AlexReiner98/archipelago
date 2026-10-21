import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, publicDocument } from '../src/public-document.ts';
import { serve } from './serve.ts';

// A one-pixel PNG.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a document a human makes public is read by anyone at its own address, with what it holds and nothing private', async () => {
  const { call, base, workspaces } = await serve('off');
  const made = (
    await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'd', type: 'work.document', title: 'Why maps', visibility: 'shared', body: '# Why maps\n\nA map keeps **people** and work in one place, so that [anyone](https://example.com) can see it.\n\n{s}\n\n{p}\n\n{o}\n\n{q}\n\nSee {o} and {s}.' },
        { op: 'create', ref: 's', type: 'work.note', title: 'Held section', visibility: 'shared', body: 'Held and shown.' },
        { op: 'create', ref: 'p', type: 'work.note', title: 'Private section', visibility: 'private', body: 'Never shown.' },
        { op: 'create', ref: 'o', type: 'work.note', title: 'Kept elsewhere', visibility: 'shared', body: 'Not public, not held.' },
        { op: 'create', ref: 'q', type: 'work.project', title: 'Public project', visibility: 'shared', body: 'Its note is never given.' },
        { op: 'link', type: 'part_of', from: 's', to: 'd' },
        { op: 'link', type: 'part_of', from: 'p', to: 'd' },
      ],
    })
  ).result.created;
  const { d, s, p, o, q } = made;
  for (const id of [s, p]) assert.equal((await call('/api/picture_put', undefined, { result: id, data: PIXEL, content_type: 'image/png' })).status, 200);
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: q, visibility: 'public' }] });

  // Not public: nothing at its address, page or data.
  assert.equal((await fetch(`${base}/p/default/${d}`)).status, 404);
  assert.equal((await fetch(`${base}/p/default/${d}/data`)).status, 404);

  // An agent's attempt waits as a proposal, as for anything public.
  const asked = await call('/agent/change', undefined, { reason: 'test', ops: [{ op: 'update', id: d, visibility: 'public' }] });
  assert.equal(asked.result.status, 'proposed');
  assert.equal((await fetch(`${base}/p/default/${d}/data`)).status, 404);

  // A human's applies, and the page is there, for anyone and for a search engine.
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: d, visibility: 'public' }] });
  const page = await fetch(`${base}/p/default/${d}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-robots-tag'), null);
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  const html = await page.text();
  assert.doesNotMatch(html, /noindex/);
  assert.match(html, /<title>Why maps<\/title>/);
  assert.match(html, /<meta name="description" content="A map keeps people and work in one place, so that anyone can see it\." \/>/);
  assert.match(html, new RegExp(`<link rel="canonical" href="/p/default/${d}" />`));
  assert.match(html, /doc\.js/);

  const data = await fetch(`${base}/p/default/${d}/data`);
  assert.equal(data.status, 200);
  const doc = (await data.json()) as { title: string; parts: { text?: string; section?: { id: string; title: string; picture: boolean } }[] };
  assert.equal(doc.title, 'Why maps');
  assert.deepEqual(doc.parts.filter((x) => x.section).map((x) => x.section!.title), ['Held section', 'Public project']);
  const said = JSON.stringify(doc);
  for (const hidden of [p, o, 'Private section', 'Never shown', 'Kept elsewhere']) assert.ok(!said.includes(hidden), `${hidden} is not given`);
  assert.ok(!said.includes('Its note is never given'), 'a public item brought in from elsewhere shows its name and state, not its note');
  assert.match(doc.parts.at(-1)!.text!, new RegExp(`^See and ${s}\\.$`), 'an id it does not show is scrubbed from the text');

  // A figure of what it shows, and of nothing else.
  const figure = await fetch(`${base}/p/default/${d}/picture/${s}`);
  assert.deepEqual([figure.status, figure.headers.get('content-type')], [200, 'image/png']);
  assert.equal((await fetch(`${base}/p/default/${d}/picture/${p}`)).status, 404);

  // The database itself gives no other public item's note as a document's.
  const { pelago } = await workspaces.get('default');
  assert.equal(await publicDocument(pelago, q), null);
  // An invoice is read as a document, but is never public.
  assert.equal(pelago.registry.type('time.invoice')?.public ?? false, false);

  // A link to it is still kept out of search engines.
  const link = (await call('/api/share_create', undefined, { id: d })).result;
  const linked = await fetch(base + link.path);
  assert.equal(linked.headers.get('x-robots-tag'), 'noindex');
  assert.match(await linked.text(), /<meta name="robots" content="noindex" \/>/);

  // Once it is not public, its address is gone again.
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: d, visibility: 'shared' }] });
  assert.equal((await fetch(`${base}/p/default/${d}`)).status, 404);
  assert.equal((await fetch(`${base}/p/default/${d}/data`)).status, 404);
  assert.equal((await fetch(`${base}/p/default/${d}/picture/${s}`)).status, 404);
});

test('a document is described by the first paragraph it opens on, cut short', () => {
  assert.equal(describe([{ text: '# Title\n\nShort title\nThe first words, said **plainly**.\n\nThe second.' }]), 'The first words, said plainly.');
  assert.equal(describe([{ section: { id: 'e_aaaaaaaa', type: 'work.note', title: 'A', status: 'current', body: '- one\n- two', updated_at: '' } }]), 'one two');
  const long = describe([{ text: 'word '.repeat(100) }]);
  assert.ok(long.length <= 160 && long.endsWith('…'));
  assert.equal(describe([]), '');
});
