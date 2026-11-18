// What a page's backdrop is told of its words and what it may tell the page (packs/walls/page/backdrop.js): a box for
// each block of words and its call to action (focus), read once and again only when the page changes, never on a
// scrolled frame; and its look, colours the page wears as --backdrop-* on its root, checked. In a real browser
// (skipped where there is no Chrome).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, type Page } from './browser.ts';
import { packsWith } from './map.ts';
import { serve } from './serve.ts';

const browser = chrome();

// Says in a tip how many boxes it heard, its focus and how often it heard the page; tells the page a look with a
// colour that is not hex and a name that is not a look's, to be dropped.
const TOLD = `export default function draw({ page, on, tip, look }) {
  let last = page, heard = 0;
  const say = () => tip(['n' + (last?.clear?.length ?? '-'), 'f' + (last?.focus ? [last.focus.x, last.focus.y, last.focus.w, last.focus.h].join(',') : '-'), 'h' + heard, 's' + last?.scroll].join(' '), 1, 1);
  on('page', (p) => { heard++; last = p; say(); });
  look({ ink: '#12345A', light: '#abc', water: 'red', land: 'url(x)', evil: '#ffffff' });
  say();
}`;

async function inFrame(page: Page, expression: string): Promise<unknown> {
  const targets = (await page.send('Target.getTargets')).result.targetInfos as { targetId: string; type: string; url: string }[];
  const frame = targets.find((t) => t.type === 'iframe' && t.url.includes('/draw.html'));
  if (!frame) return undefined;
  const session = (await page.send('Target.attachToTarget', { targetId: frame.targetId, flatten: true })).result?.sessionId;
  return (await page.send('Runtime.evaluate', { expression, returnByValue: true }, session)).result?.result?.value;
}
const tipOf = async (page: Page) => String((await inFrame(page, `document.querySelector('.tip')?.textContent ?? ''`)) ?? '');
const until = async (page: Page, ok: (said: string) => boolean) => {
  let said = '';
  for (let n = 0; n < 100 && !ok(said); n++) (said = await tipOf(page)), await new Promise((r) => setTimeout(r, 100));
  return said;
};

test('in a browser, a backdrop is told a box for each block and its call to action, read again only when the page changes, and its look is worn checked', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off', undefined, undefined, packsWith('reader'));
  const body = '{l}\n\nThe first paragraph of words.\n\n[Start a new map](https://example.com/start)\n\nThe last paragraph.\n\n' + Array.from({ length: 40 }, (_, i) => `- Line ${i + 1}`).join('\n');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [
    { op: 'create', ref: 'd', type: 'writing', title: 'Home', visibility: 'shared', body },
    { op: 'create', ref: 's', type: 'layout', title: 'Told land', visibility: 'shared', props: { code: TOLD } },
    { op: 'create', ref: 'l', type: 'lens', title: 'The land', visibility: 'shared', body: 'The land.', props: { filter: { find: ['type writing'] } } },
    { op: 'link', type: 'part_of', from: 'l', to: 'd' },
  ] })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.l, props: { style: { style: made.s, numbers: { page_backdrop: 1 } } } }] });
  assert.equal((await call('/api/publish', undefined, { id: made.d })).status, 200);
  const page = await open('about:blank');
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.go(`${base}/p/default/${made.d}`);
    assert.ok(await page.until(`document.querySelector('body > iframe.page-backdrop.drew') !== null`, 20000), `the backdrop has drawn: ${page.logs().join(' / ')}`);
    let said = await until(page, (s) => /^n\d+ f\d/.test(s));
    // Each item apart (the owner, 17 Nov 2026): each link of the nav, the title, three paragraphs (the call to action's
    // link alone), each line of the list, and what the foot holds.
    const blocks = (await page.evaluate(`(() => { const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top + scrollY, r.width, r.height].map(Math.round).join(','); }; const shown = (el) => el.getBoundingClientRect().height > 0; const into = (el) => (getComputedStyle(el).display === 'contents' ? [...el.children].flatMap(into) : !shown(el) ? [] : el.matches('nav.site-head, .site-pages, ul, ol, footer') ? [...el.children].flatMap(into) : [el]); return { n: [...document.querySelectorAll('nav.site-head, main > header, main div.text > *, main footer')].flatMap(into).length, lines: document.querySelectorAll('main div.text li').length, focus: box(document.querySelector('main p.action a')) }; })()`)) as { n: number; lines: number; focus: string };
    assert.equal(blocks.lines, 40, 'the list has its forty lines');
    assert.ok(blocks.n >= 45, `the page has its items: ${blocks.n}`);
    assert.equal(said.split(' ')[0], `n${blocks.n}`, `a box for each block: ${said}`);
    assert.equal(said.split(' ')[1], `f${blocks.focus}`, `its focus is the call to action's link: ${said}`);
    // Its look, worn on the page's root: the hex colours it named, lower case; the rest dropped.
    assert.ok(await page.until(`getComputedStyle(document.documentElement).getPropertyValue('--backdrop-ink').trim() === '#12345a'`, 5000), 'the page wears its ink');
    const worn = (await page.evaluate(`['ink', 'light', 'water', 'land', 'evil'].map((k) => document.documentElement.style.getPropertyValue('--backdrop-' + k))`)) as string[];
    assert.deepEqual(worn, ['#12345a', '#abc', '', '', ''], 'only hex colours of a look’s names are worn');
    // Scrolling reads no words: their boxes are kept.
    await page.evaluate(`(() => { window.__reads = 0; const was = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { window.__reads++; return was.call(this); }; })()`);
    for (const y of [100, 200, 300, 150, 250]) {
      await page.evaluate(`scrollTo(0, ${y})`);
      await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    }
    said = await until(page, (s) => / s250$/.test(s));
    assert.match(said, / s250$/, `it heard the scroll: ${said}`);
    assert.equal(await page.evaluate(`window.__reads`), 0, 'no box was read while the page scrolled');
    // A block added to the page is told, read once.
    await page.evaluate(`document.querySelector('main div.text').append(Object.assign(document.createElement('p'), { textContent: 'A new paragraph.' }))`);
    said = await until(page, (s) => s.startsWith(`n${blocks.n + 1} `));
    assert.ok(said.startsWith(`n${blocks.n + 1} `), `the new block is told: ${said}`);
    assert.ok(Number(await page.evaluate(`window.__reads`)) > 0, 'its words were read again');
  } finally {
    await page.close();
  }
});
