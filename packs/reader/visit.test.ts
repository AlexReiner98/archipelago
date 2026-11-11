// Visits to a public site, as the reader reads them without a database: what the kernel hands of a request goes in,
// whether it is a reader's page load and under which tag it counts come out, and the tag its page's links carry on.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageOf, siteOf, visitOf } from './reader.js';
import { isVisit, sourceOf, tagOf } from './visit.js';

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TEMPLATE = '<html><head><title>Document</title></head><body><main id="main"></main><script type="module" src="/doc.js"></script></body></html>';
const D = 'e_doc00001';
const home = { id: D, title: 'Home', path: 'home', parts: [{ text: 'Words.' }] };
const act = async (name: string, input: Record<string, unknown>) =>
  name === 'public.list' ? [] : name === 'public.at' ? (input.path === 'home' ? home : null) : name === 'public.read' ? (input.id === D ? home : null) : null;
const ask = (query = '', more: Record<string, string> = {}) => ({ query, host: 'site.example', referrer: '', agent: BROWSER, purpose: '', ...more });

test('a reader is a browser, not a bot or a page fetched ahead', () => {
  assert.ok(isVisit(ask()));
  for (const bot of ['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)', 'Twitterbot/1.0', 'facebookexternalhit/1.1', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 (compatible; Discordbot/2.0)', 'Cardyb/1.1', 'TelegramBot (like TwitterBot)', 'WhatsApp/2.23', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'SomeCrawler/1', 'a spider', 'Link Preview'])
    assert.ok(!isVisit(ask('', { agent: bot })), bot);
  assert.ok(!isVisit(ask('', { purpose: 'prefetch' })));
  assert.ok(!isVisit(ask('', { purpose: 'prefetch;prerender' })));
});

test('the tag: its ref, else its utm_source, else the other site that sent the reader', () => {
  assert.equal(sourceOf('ref=linkedin', 'site.example', ''), 'linkedin');
  assert.equal(sourceOf('ref=linkedin&utm_source=chatgpt.com', 'site.example', 'https://claude.ai/'), 'linkedin', 'a ref wins');
  assert.equal(sourceOf('utm_source=chatgpt.com', 'site.example', 'https://claude.ai/'), 'chatgpt', 'then utm_source');
  assert.equal(sourceOf('utm_source=Newsletter', 'site.example', ''), 'newsletter', 'a plain word is the tag');
  assert.equal(sourceOf('', 'site.example', 'https://claude.ai/chat/1'), 'claude', 'then the referrer');
  assert.equal(sourceOf('', 'site.example', 'https://www.google.com/'), 'google');
  assert.equal(sourceOf('', 'site.example', 'https://news.ycombinator.com/item?id=1'), 'ycombinator');
  assert.equal(sourceOf('', 'site.example', 'https://site.example/pricing'), null, 'the site itself is no source');
  assert.equal(sourceOf('', 'site.example', 'https://app.site.example/'), null, 'nor a name under it');
  assert.equal(sourceOf('', 'site.example', ''), null);
  assert.equal(sourceOf('', 'site.example', 'not a url'), null);
  assert.equal(sourceOf('', 'site.example', 'https://localhost/'), null, 'a referrer that makes no tag');
  assert.equal(sourceOf('utm_source=a%20b', 'site.example', 'https://claude.ai/'), null, 'a utm_source that makes no tag');
  assert.equal(sourceOf('ref=a%20b', 'site.example', 'https://claude.ai/'), null, 'a ref that is no tag falls back to nothing');
  assert.equal(tagOf(ask('', { referrer: 'https://www.site.example/x' }), 'www.site.example'), null, 'the site is read without www.');
  assert.equal(tagOf(undefined, 'site.example'), null);
});

test("a site's page read by a reader with a tag is a visit, counted under it; nothing else is", async () => {
  const parts = (path: string, request = ask('ref=x')) => ({ workspace: 'acme', path, host: 'site.example', request });
  const visit = async (path: string, request?: ReturnType<typeof ask>) => visitOf(parts(path, request), await siteOf(parts(path, request), act, TEMPLATE));
  assert.equal(await visit('/'), 'x');
  for (const path of ['/data', '/robots.txt', '/home', '/nowhere', '/sitemap.xml']) assert.equal(await visit(path), null, path);
  assert.equal(await visit('/', ask('ref=x', { agent: 'LinkedInBot/1.0' })), null, 'a bot');
  assert.equal(await visit('/', ask('ref=x', { purpose: 'prefetch' })), null, 'a prefetch');
  assert.equal(await visit('/', ask()), null, 'no tag, no count');
  assert.equal(await visit('/', ask('', { referrer: 'https://news.ycombinator.com/item?id=1' })), 'ycombinator');
  assert.equal(visitOf(parts('/'), { status: 404, html: '<p>no</p>' }), null, 'a page not found');
});

test('a public view at /p/ read by a reader with a tag is a visit too, counted on its site, or its own map with none', async () => {
  const { default: handler } = await import('./handler.js');
  const counted: Record<string, unknown>[] = [];
  const ctx = { act: async (name: string, input: Record<string, unknown>) => (name === 'count.add' ? void counted.push(input) : act(name, input)) };
  await handler.page({ workspace: 'acme', id: D, domain: 'site.example', request: ask('ref=launch', { host: 'app.example' }) }, ctx);
  assert.deepEqual(counted, [{ site: 'site.example', key: 'launch' }]);
  await handler.page({ workspace: 'acme', id: D, domain: 'site.example', request: ask('', { host: 'app.example' }) }, ctx);
  assert.equal(counted.length, 1, 'no tag, nothing counted');
  await handler.page({ workspace: 'acme', id: D, request: ask('ref=launch', { host: 'app.example' }) }, ctx);
  assert.deepEqual(counted.at(-1), { workspace: 'acme', key: 'launch' }, 'a workspace with no site is counted on its own map');
  await handler.site({ workspace: 'acme', path: '/', host: 'site.example', request: ask('ref=post') }, ctx);
  assert.deepEqual(counted.at(-1), { site: 'site.example', key: 'post' }, 'and its site, as before');
});

test("a page's data carries the tag its reader came by, for its links to the site; with none, nothing", async () => {
  const dataOf = (html: string) => JSON.parse(/id="page-data">(.*)<\/script>/.exec(html)![1]);
  const site = (await siteOf({ workspace: 'acme', path: '/', host: 'site.example', request: ask('utm_source=chatgpt.com') }, act, TEMPLATE)) as { html: string };
  assert.deepEqual(dataOf(site.html).carry, { ref: 'chatgpt' });
  const plain = (await siteOf({ workspace: 'acme', path: '/', host: 'site.example', request: ask() }, act, TEMPLATE)) as { html: string };
  assert.equal(dataOf(plain.html).carry, undefined);
  const pub = (await pageOf({ workspace: 'acme', id: D, request: ask('ref=linkedin', { host: 'app.example' }) }, act, TEMPLATE)) as { html: string };
  assert.deepEqual(dataOf(pub.html).carry, { ref: 'linkedin' }, 'at /p/ too');
  assert.equal(((await siteOf({ workspace: 'acme', path: '/data', host: 'site.example', request: ask('ref=x') }, act, TEMPLATE)) as { json: { carry?: unknown } }).json.carry, undefined, "its data read alone is the page's, the same for everyone");
});
