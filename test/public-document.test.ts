import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, publicDocument } from '../src/public-document.ts';
import { gist } from '../src/published.ts';
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

  // A human's applies, but nothing is read until it is published: what anyone reads is a published revision.
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: d, visibility: 'public' }] });
  assert.equal((await fetch(`${base}/p/default/${d}/data`)).status, 404);
  // Only a human publishes.
  assert.notEqual((await call('/agent/publish', undefined, { id: d })).status, 200);
  assert.equal((await call('/api/publish', undefined, { id: d })).status, 200);
  // Published, the page is there, for anyone and for a search engine.
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

test('a published document reads as it was published until it is published again, its pictures frozen', async () => {
  const { call, base } = await serve('off');
  const made = (
    await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'd', type: 'work.document', title: 'How it works', visibility: 'shared', body: 'Opening words.\n\n{s}\n\n{l}' },
        { op: 'create', ref: 's', type: 'work.note', title: 'A section', visibility: 'shared', body: 'As first written.' },
        { op: 'create', ref: 'f', type: 'software.feature', title: 'The system', visibility: 'shared', body: 'The whole of it.' },
        { op: 'create', ref: 'a', type: 'work.task', title: 'A part', visibility: 'shared', body: 'Does the first thing. Then more ({b}).' },
        { op: 'create', ref: 'b', type: 'work.task', title: 'Another part', visibility: 'shared', body: 'Does the second.' },
        { op: 'create', ref: 'x', type: 'work.task', title: 'A private part', visibility: 'private', body: 'Never shown.' },
        { op: 'create', ref: 'l', type: 'lens', title: 'The system, drawn', visibility: 'shared', status: 'current', props: { filter: { types: ['work.task', 'software.feature'] } } },
        { op: 'link', type: 'about', from: 'l', to: 'f' },
        { op: 'link', type: 'part_of', from: 'a', to: 'f' },
        { op: 'link', type: 'part_of', from: 'b', to: 'f' },
        { op: 'link', type: 'part_of', from: 'x', to: 'f' },
        { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
        { op: 'link', type: 'part_of', from: 's', to: 'd' },
        { op: 'link', type: 'part_of', from: 'l', to: 'd' },
      ],
    })
  ).result.created;
  const { d, s, l, a, x } = made;
  assert.equal((await call('/api/published', undefined, { id: d })).result.published, false);
  assert.equal((await call('/api/publish', undefined, { id: d })).status, 200);
  const read = async () => (await (await fetch(`${base}/p/default/${d}/data`)).json()) as { published_at: string; parts: { section?: { id: string; body: string } }[]; lenses: Record<string, { items: { id: string; title: string; gist: string; state: { waits_on: unknown[]; sessions: number } }[] }> };
  const first = await read();
  assert.ok(first.published_at);
  const picture = first.lenses[l];
  assert.ok(picture, 'a lens it holds is frozen with it');
  assert.deepEqual(picture.items.map((i) => i.title).sort(), ['A part', 'Another part', 'The system']);
  assert.equal(picture.items.find((i) => i.id === a)!.gist, 'Does the first thing.');
  assert.ok(picture.items.every((i) => !('owner' in i)), 'nothing about who');
  assert.ok(!JSON.stringify(first).includes(x) && !JSON.stringify(first).includes('Never shown'), 'nothing private is frozen');

  // The draft is changed: nothing public changes, and the owner is told the draft says something else.
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: s, body: 'Rewritten.' }] });
  assert.equal((await read()).parts.find((p) => p.section?.id === s)!.section!.body, 'As first written.');
  assert.equal((await call('/api/published', undefined, { id: d })).result.changed, true);
  await call('/api/publish', undefined, { id: d });
  assert.equal((await read()).parts.find((p) => p.section?.id === s)!.section!.body, 'Rewritten.');
  assert.equal((await call('/api/published', undefined, { id: d })).result.changed, false);

  // Unpublished, its address answers nothing and it is shared again.
  await call('/api/unpublish', undefined, { id: d });
  assert.equal((await fetch(`${base}/p/default/${d}/data`)).status, 404);
  assert.equal((await call('/api/get', undefined, { id: d })).result.entity.visibility, 'shared');
});

test('a published document links to the other published documents it names, and to nothing else', async () => {
  const { call, base } = await serve('off');
  const { a, b, c } = (
    await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'a', type: 'work.document', title: 'First steps', visibility: 'shared', body: 'Start here.' },
        { op: 'create', ref: 'c', type: 'work.document', title: 'Not out yet', visibility: 'shared', body: 'A draft.' },
        { op: 'create', ref: 'b', type: 'work.document', title: 'Going further', visibility: 'shared', body: 'After {a}, read on. Later: {c}.' },
      ],
    })
  ).result.created;
  await call('/api/publish', undefined, { id: a });
  await call('/api/publish', undefined, { id: b });
  const read = (await (await fetch(`${base}/p/default/${b}/data`)).json()) as { links?: Record<string, string>; parts: { text?: string }[] };
  assert.deepEqual(read.links, { [a]: 'First steps' });
  assert.match(read.parts[0].text!, new RegExp(`After ${a}, read on\\. Later:\\.$`), 'a document not published is not named');
  assert.ok(!JSON.stringify(read).includes(c));
});

test('a part is told by its first sentence, with no ids', () => {
  assert.equal(gist('Does one thing (e_abcdefgh). Then another.\n\nMore.'), 'Does one thing.');
  assert.equal(gist(''), '');
  assert.ok(gist('word '.repeat(80)).endsWith('…'));
});

test('a document is described by the first paragraph it opens on, cut short', () => {
  assert.equal(describe([{ text: '# Title\n\nShort title\nThe first words, said **plainly**.\n\nThe second.' }]), 'The first words, said plainly.');
  assert.equal(describe([{ section: { id: 'e_aaaaaaaa', type: 'work.note', title: 'A', status: 'current', body: '- one\n- two', updated_at: '' } }]), 'one two');
  const long = describe([{ text: 'word '.repeat(100) }]);
  assert.ok(long.length <= 160 && long.endsWith('…'));
  assert.equal(describe([]), '');
});
