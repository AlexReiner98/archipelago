// A baked page (bake.js, baked-site.js): a frozen bake in, a page and counts out, with no database.

import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error the pack's code is plain JavaScript
import { bakedPage, lookCss, svgOf } from './bake.js';
// @ts-expect-error the pack's code is plain JavaScript
import { bakedSite, keyOf } from './baked-site.js';

const A = 'e_aaaaaaaa', B = 'e_bbbbbbbb';
const baked = {
  section: 'e_hhhhhhhh',
  key: 'k',
  style: { sizes: { rails_stop_span: 560, bad: 'url(x)' }, numbers: { rails_ease: 1 }, colors: { accent: '#abc', text: 'red;}' } },
  scene: {
    svg: ['svg', { viewBox: '0 0 100 100', key: 'root' }, ['a', { href: `#/e/${A}`, class: 'lf-step', on: ['click'] }, ['text', { x: 1 }, 'One & <two>']], ['rect', { item: B, width: 4 }]],
    css: '.lf-step { fill: var(--ln-land); }',
    size: { width: 100, height: 100 },
    stops: [{ id: A, title: 'One', note: 'First <b>note</b>.', x: 10, y: 10, span: 50, zoom: 2 }, { id: B, title: 'Two', note: '', x: 50, y: 50, span: 50, zoom: 2 }],
    whole: { x: 50, y: 50, span: 100, zoom: 1 },
  },
};
const doc = { id: 'e_hhhhhhhh', title: 'Home', parts: [], theme: { light: { bg: '#fff', 'x;': '#000' }, dark: { bg: '#000' } } };

test('marks are written as SVG: a link to an item leads to its stop, the live page’s attributes left out, words escaped', () => {
  const svg = svgOf(baked.scene.svg);
  assert.match(svg, /^<svg viewBox="0 0 100 100" xmlns="http:\/\/www\.w3\.org\/2000\/svg">/);
  assert.ok(svg.includes(`<a href="#s-${A}" data-item="${A}" class="lf-step">`));
  assert.ok(svg.includes(`<rect data-item="${B}" width="4">`));
  assert.ok(svg.includes('One &#38; &#60;two&#62;'));
  assert.ok(!/key=|on=/.test(svg));
});

test('marks a drawing may not send are refused, as the page refuses them', () => {
  assert.throws(() => svgOf(['svg', {}, ['script', {}, 'x']]), /the tag "script"/);
  assert.throws(() => svgOf(['svg', { onload: 'x' }]), /the attribute "onload"/);
  assert.throws(() => svgOf(['svg', { style: 'x' }]), /the attribute "style"/);
  assert.throws(() => svgOf(['a', { href: 'https://evil.example' }]), /a link to/);
  assert.throws(() => svgOf(['g', { item: 'e_x"><script>' }]), /the item/);
});

test('the page holds each stop’s title and note in order, the walk’s markup, and no script or style of its own', () => {
  const html = bakedPage(baked, doc, { title: 'Home', look: '/look.css?v=k', site: { name: 'Site', footer: 'Made <here>.' }, start: '/go/start', stop: baked.scene.stops[1], ref: 'hn' });
  assert.ok(html.indexOf(`id="s-${A}"`) < html.indexOf(`id="s-${B}"`));
  assert.ok(html.includes(`<li class="rails-stop" id="s-${A}" data-item="${A}" data-at="10 10 50"><div class="rails-card"><h2>One</h2><p>First &#60;b&#62;note&#60;/b&#62;.</p></div></li>`));
  assert.ok(html.includes(`<section class="rails" data-whole="50 50 100" data-start="${B}" data-ref="hn">`));
  assert.ok(html.includes('<h1>Home</h1>'), 'the band above the walk');
  assert.ok(html.includes('Made &#60;here&#62;.'));
  assert.ok(!/<style|<script(?![^>]*\bsrc=)/.test(html));
});

test('the look is the page’s theme for each scheme and the style’s values, held to what a style may say', () => {
  const css = lookCss(baked, doc);
  assert.match(css, /--bg: #fff;/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n:root \{\n {2}--bg: #000;/);
  assert.match(css, /--ln-rails-stop-span: 560px;/);
  assert.match(css, /--ln-accent: #abc;/);
  for (const bad of ['url(x)', 'red;}', '--x;']) assert.ok(!css.includes(bad), bad);
  assert.match(css, /\.rails \{\n\.lf-step/);
});

/** The kernel as the pack sees it: the acts it answers, and the counts it is asked to add. */
function kernel(home = baked) {
  const counts: string[] = [];
  const act = async (name: string, input: { path?: string }) => (name === 'public.baked' ? home : name === 'public.at' && input.path === 'home' ? doc : null);
  return { counts, act, count: async (key: string) => void counts.push(key) };
}
const parts = (path: string, request: Record<string, string> = {}) => ({ workspace: 'w', path, host: 'site.test', name: 'Site', app: 'https://app.test', start: '/x/work/start', request: { host: 'site.test', ...request } });

test('an arrival at a stop and a press of the main button are counted under the tag, counts only', async () => {
  const k = kernel();
  assert.deepEqual(await bakedSite(parts(`/go/seen/${A}`, { query: 'ref=hn' }), k.act, k.count), { text: '', type: 'text/plain' });
  const start = await bakedSite(parts('/go/start'), k.act, k.count);
  assert.deepEqual(start, { redirect: 'https://app.test/x/work/start', status: 302 });
  await bakedSite(parts('/go/start', { agent: 'Twitterbot' }), k.act, k.count);
  assert.deepEqual(k.counts, ['stop-aaaaaaaa-hn', 'start-direct'], 'a bot is not counted');
  assert.equal(keyOf('stop-aaaaaaaa', 'x'.repeat(40)).length, 40);
  assert.equal((await bakedSite(parts('/go/seen/e_zzzzzzzz'), k.act, k.count)).status, 404);
});

test('an agent asking for JSON at / is given the stops and the install line; a page is given otherwise', async () => {
  const k = kernel();
  const json = (await bakedSite(parts('/', { accept: 'application/json' }), k.act, k.count)).json;
  assert.deepEqual(json.stops.map((s: { href: string }) => s.href), [`https://site.test/${A}`, `https://site.test/${B}`]);
  assert.match(json.install, /https:\/\/app\.test\/connect\/install/);
  assert.match((await bakedSite(parts('/', { accept: 'text/html,application/json' }), k.act, k.count)).html, /class="rails"/);
  const at = (await bakedSite(parts(`/${B}`), k.act, k.count)).html;
  assert.match(at, /<title>Two · Site<\/title>/);
  assert.equal(await bakedSite(parts('/e_zzzzzzzz'), k.act, k.count), null, 'no such stop: the site answers it');
});

test('a site whose home is not baked is answered as it was', async () => {
  const k = kernel(null as never);
  for (const path of ['/', `/${A}`, '/look.css', '/go/start', '/about']) assert.equal(await bakedSite(parts(path), k.act, k.count), null, path);
  assert.equal((await bakedSite(parts('/rails.js'), k.act, k.count)).type, 'text/javascript');
});
