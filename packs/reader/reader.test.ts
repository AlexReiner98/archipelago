// The reader, run without a database: the parts of an address and what the public acts give go in, what the
// kernel is to send comes out. The acts are a table here.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, publishedPage } from './head.js';
import { pageOf, siteOf } from './reader.js';

const TEMPLATE = '<html><head><meta name="robots" content="noindex" />\n<title>Document</title></head><body><main id="main"><p>Loading…</p></main><script type="module" src="/doc.js"></script></body></html>';
const HASH = 'a'.repeat(64);
const D = 'e_doc00001', HOMEID = 'e_home0001', SEC = 'e_sec00001', VIEW = 'e_view0001';
const view = { id: VIEW, title: 'The roadmap', path: null, parts: [{ section: { id: VIEW, title: 'The roadmap', body: '' } }], lenses: { [VIEW]: { items: [] } } };

const lens = (at: string) => ({ [SEC]: { style: { drawing: { id: 'flow', title: 'Flow', hash: HASH, src: `${at}/drawing/${HASH}` } } } });
const doc = { id: D, title: 'About <us>', path: 'about', share: SEC, parts: [{ text: 'The first words.' }, { section: { id: SEC, title: 'A figure', picture: true, body: '' } }], lenses: lens(`/p/acme/${D}`) };
const home = { id: HOMEID, title: 'Home', path: 'home', share: SEC, parts: [{ section: { id: SEC, title: 'Hero', picture: true, body: '' } }] };
const footer = { id: 'e_foot0001', title: 'Footer', path: 'footer', parts: [{ text: 'Contact us.' }, { text: 'Legal.' }] };
const pages = [
  { id: HOMEID, title: 'Home', path: 'home', menu: 0, published_at: '2026-11-01T00:00:00Z' },
  { id: D, title: 'About', path: 'about', menu: 1, published_at: '2026-11-02T00:00:00Z' },
  { id: 'e_foot0001', title: 'Footer', path: 'footer', menu: null, published_at: '2026-11-03T00:00:00Z' },
  { id: VIEW, title: 'The roadmap', path: null, menu: null, published_at: '2026-11-04T00:00:00Z' },
];

/** The acts as the kernel answers them for the workspace acme, each asked of it kept in asked. */
function acts() {
  const asked: [string, Record<string, unknown>][] = [];
  const act = async (name: string, input: Record<string, unknown>) => {
    asked.push([name, input]);
    if (input.workspace !== 'acme') return name === 'public.list' ? [] : null;
    if (name === 'public.read') return ({ [D]: doc, [VIEW]: view } as Record<string, unknown>)[input.id as string] ?? null;
    if (name === 'public.at') return ({ about: doc, home, footer } as Record<string, unknown>)[input.path as string] ?? null;
    if (name === 'public.list') return pages;
    if (name === 'public.picture') return input.section === SEC ? { content_type: 'image/png', base64: 'AAAA' } : null;
    if (name === 'public.drawing') return input.hash === HASH ? { 'entry.js': 'export const picture = () => null;' } : null;
    throw new Error(`no act ${name}`);
  };
  return { act, asked };
}

test('a published document at /p/ is its page: its head for search engines, its data in it, its site beside it', async () => {
  const { act } = acts();
  const page = (await pageOf({ workspace: 'acme', id: D, name: 'Acme', named: 'app.example' }, act, TEMPLATE)) as { html: string };
  assert.match(page.html, /<title>About &#60;us&#62;<\/title>/);
  assert.match(page.html, /<meta name="description" content="The first words." \/>/);
  assert.match(page.html, /<link rel="canonical" href="https:\/\/app.example\/p\/acme\/e_doc00001" \/>/);
  assert.match(page.html, /og:image" content="https:\/\/app.example\/p\/acme\/e_doc00001\/picture\/e_sec00001"/);
  assert.match(page.html, /og:site_name" content="Acme"/);
  assert.match(page.html, /twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(page.html, /noindex|Loading/);
  const data = JSON.parse(/id="page-data">(.*)<\/script>/.exec(page.html)![1]);
  assert.deepEqual(data.site, { footer: 'Contact us.\n\nLegal.', name: 'Acme', home: `/p/acme/${HOMEID}`, pages: [{ title: 'About', href: `/p/acme/${D}` }] });
  assert.ok(page.html.indexOf('src="/doc.js') < page.html.indexOf('id="page-data"'), 'its script is asked for before its data is read');
  // On its site's domain, that is the address to keep.
  assert.match(((await pageOf({ workspace: 'acme', id: D, domain: 'acme.example' }, act, TEMPLATE)) as { html: string }).html, /canonical" href="https:\/\/acme.example\/about"/);
});

test('below its address: its data, a figure, a drawing by its hash, its stream', async () => {
  const { act } = acts();
  const at = (what: string, extra?: string) => pageOf({ workspace: 'acme', id: D, what, ...(extra && { extra }) }, act, TEMPLATE);
  assert.equal(((await at('data')) as { json: { title: string } }).json.title, 'About <us>');
  assert.deepEqual(await at('picture', SEC), { picture: { content_type: 'image/png', base64: 'AAAA' }, cache: 300 });
  assert.deepEqual(await at('drawing', HASH), { json: { 'entry.js': 'export const picture = () => null;' }, cache: 31_536_000 });
  assert.deepEqual(await at('drawing', 'nope'), { status: 404, json: { error: 'Not found' } });
  assert.deepEqual(await at('live'), { stream: true });
  // A picture it does not hold may be a public result's: the kernel's to answer, as is anything it does not know.
  assert.deepEqual(await at('picture', 'e_other001'), { pass: true });
  assert.deepEqual(await at('else'), { pass: true });
});

test('what is not a published document is passed on, unread where its address cannot be one', async () => {
  const { act, asked } = acts();
  assert.deepEqual(await pageOf({ workspace: 'acme', id: 'e_product1' }, act, TEMPLATE), { pass: true });
  assert.deepEqual(await pageOf({ workspace: 'nobody', id: D }, act, TEMPLATE), { pass: true });
  assert.deepEqual(await pageOf({ workspace: 'Acme!', id: D }, act, TEMPLATE), { pass: true });
  assert.deepEqual(await pageOf({ workspace: 'acme', id: 'not-an-id' }, act, TEMPLATE), { pass: true });
  assert.equal(asked.length, 2, 'an address that cannot be a document asks nothing');
});

test('a site: its front page at /, each page at its word, its figures, drawings, robots and sitemap', async () => {
  const { act } = acts();
  const at = (path: string) => siteOf({ workspace: 'acme', path, host: 'acme.example', name: 'Acme' }, act, TEMPLATE);
  const about = (await at('/about')) as { html: string };
  assert.match(about.html, /canonical" href="https:\/\/acme.example\/about"/);
  assert.match(about.html, /og:image" content="https:\/\/acme.example\/about\/picture\/e_sec00001"/);
  const data = ((await at('/about/data')) as { json: { site: unknown; lenses: Record<string, { style: { drawing: { src: string } } }> } }).json;
  assert.deepEqual(data.site, { footer: 'Contact us.\n\nLegal.', name: 'Acme', home: '/', pages: [{ title: 'About', href: '/about' }], host: 'acme.example' });
  assert.equal(data.lenses[SEC].style.drawing.src, `/about/drawing/${HASH}`, "a drawing is read below the page's own address");
  assert.match(((await at('/')) as { html: string }).html, /<title>Home<\/title>/);
  assert.deepEqual(await at('/home'), { redirect: '/', status: 301 });
  assert.deepEqual(await at('/picture/e_sec00001'), { picture: { content_type: 'image/png', base64: 'AAAA' }, cache: 300 });
  assert.deepEqual(await at('/about/picture/e_nothere1'), { status: 404, json: { error: 'Not found' } });
  assert.deepEqual(await at(`/about/drawing/${HASH}`), { json: { 'entry.js': 'export const picture = () => null;' }, cache: 31_536_000 });
  assert.deepEqual(await at('/about/live'), { stream: true, id: D });
  assert.deepEqual(await at('/robots.txt'), { text: 'User-agent: *\nAllow: /\nSitemap: https://acme.example/sitemap.xml\n', type: 'text/plain' });
  const map = (await at('/sitemap.xml')) as { text: string; type: string };
  assert.equal(map.type, 'application/xml');
  assert.match(map.text, /<loc>https:\/\/acme.example\/<\/loc><lastmod>2026-11-01<\/lastmod>/);
  assert.doesNotMatch(map.text, /footer/);
  // Every public view is in it: one with no address word at its own address on the site's domain, read there too.
  assert.match(map.text, /<loc>https:\/\/acme.example\/p\/acme\/e_view0001<\/loc><lastmod>2026-11-04<\/lastmod>/);
  const roadmap = (await at(`/p/acme/${VIEW}`)) as { html: string };
  assert.match(roadmap.html, /canonical" href="https:\/\/acme.example\/p\/acme\/e_view0001"/);
  assert.equal(((await at(`/p/acme/${VIEW}/data`)) as { json: { title: string } }).json.title, 'The roadmap');
  assert.deepEqual(await at(`/p/other/${VIEW}`), { pass: true }, "another workspace's view is not this site's");
  // An address no published page has is not the site's.
  for (const path of ['/nothing', '/doc.js', '/a/b/c/d', '/about/else/x', '/about/data/x']) assert.deepEqual(await at(path), { pass: true }, path);
});

test('a page with no share of its own on a site shows its front page figure; with no front page, / says so', async () => {
  const { act } = acts();
  const plain = { ...doc, parts: [{ text: 'Words.' }] };
  const only = async (name: string, input: Record<string, unknown>) => (name === 'public.at' && input.path === 'about' ? plain : act(name, input));
  assert.match(((await siteOf({ workspace: 'acme', path: '/about', host: 'acme.example' }, only, TEMPLATE)) as { html: string }).html, /og:image" content="https:\/\/acme.example\/picture\/e_sec00001"/);
  const empty = async (name: string) => (name === 'public.list' ? [] : null);
  assert.deepEqual(await siteOf({ workspace: 'acme', path: '/', host: 'acme.example' }, empty, TEMPLATE), { status: 404, text: 'This site has no front page yet.', type: 'text/plain' });
});

test('a document is described by the first paragraph it opens on, cut short', () => {
  assert.equal(describe([{ text: '# Title\n\nShort title\nThe first words, said **plainly**.\n\nThe second.' }]), 'The first words, said plainly.');
  assert.equal(describe([{ section: { id: 'e_aaaaaaaa', type: 'record', title: 'A', status: 'current', body: '- one\n- two', updated_at: '' } }]), 'one two');
  const long = describe([{ text: 'word '.repeat(100) }]);
  assert.ok(long.length <= 160 && long.endsWith('…'));
  assert.equal(describe([]), '');
});

test('a page says its words with no script run: an agent that fetches it reads them', () => {
  const text = 'Get going.\n\n## Connect\n\nAsk it to [install](https://app.example/connect/install), `one line`, **now**.\n\n- one\n- two\n\n```bash\nnpm <start>\n```\n\n[not this](javascript:alert(1)) <script>';
  const html = publishedPage(TEMPLATE, { title: 'Quick <start>', parts: [{ text }, { section: { id: SEC, title: 'A figure', picture: true, body: '' } }] }, 'https://x.example/', undefined, {});
  assert.match(html, /<main id="main"><\/main>/, 'the page is drawn in main by its script, with nothing there before it');
  const main = /<article class="page-words">([\s\S]*?)<\/article>/.exec(html)![1];
  assert.ok(main.startsWith('<h1>Quick &#60;start&#62;</h1>'));
  assert.ok(main.includes('<h2>Connect</h2>') && main.includes('<a href="https://app.example/connect/install">install</a>') && main.includes('<code>one line</code>') && main.includes('<b>now</b>'));
  assert.ok(main.includes('<ul><li>one</li><li>two</li></ul>') && main.includes('<pre>npm &#60;start&#62;</pre>'));
  assert.ok(!main.includes('<script') && !main.includes('href="javascript'), 'only words and safe links');
  assert.ok(!main.includes('Loading'));
});

test("nothing a document says closes the page's data or is read as a pattern", () => {
  const html = publishedPage(TEMPLATE, { title: '$& $\'', parts: [] }, 'https://x.example/', undefined, { said: '</script><!--' });
  assert.match(html, /<title>\$&#38; \$&#39;<\/title>/);
  assert.ok(!html.includes('</script><!--'));
});
