// A layout run as a page's backdrop (task e_m2wsf8m5): a view whose numbers say page_backdrop runs its layout's code
// walled in, in a frame fixed behind the published page (packs/walls/page/backdrop.js), told the page's size, scroll
// and the boxes of its words as on('page') events, and painting with WebGL2 on the canvas its worker is handed. In a
// real browser (skipped where there is no Chrome).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, pageModule, type Page } from './browser.ts';
import { packsWith } from './map.ts';
import { serve } from './serve.ts';

const browser = chrome();

// Paints the window magenta with WebGL2 and says, in a tip, what it was given and what it heard; tries what it may not.
const LIVE = (api: string) => `export default async function draw({ canvas, page, reducedMotion, on, tip }) {
  const gl = canvas.getContext('webgl2');
  let heard = 0, last = page, reached = 'blocked';
  const big = (p) => [...(p?.clear ?? [])].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 1).map((b) => [b.x, b.y, b.w, b.h].join(',')).join('') || '-';
  try { await fetch(${JSON.stringify(api)}, { method: 'POST' }); reached = 'reached'; } catch {}
  const paint = () => { if (!gl) return; gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); };
  const say = () => tip([gl ? 'gl2' : 'nogl', canvas.constructor.name, typeof document, typeof parent, reached, String(!!page), heard, last?.visible, last?.scroll, last?.clear?.length, last?.width, last?.view?.width, String(reducedMotion), big(last)].join(' '), 1, 1);
  on('page', (p) => { heard++; last = p; paint(); say(); });
  paint();
  say();
}`;

/** What an expression comes to inside the backdrop's frame (an isolated process of its own: a session attached to it). */
async function inFrame<T>(page: Page, expression: string): Promise<T | undefined> {
  const targets = (await page.send('Target.getTargets')).result.targetInfos as { targetId: string; type: string; url: string }[];
  const frame = targets.find((t) => t.type === 'iframe' && t.url.includes('/draw.html'));
  if (!frame) return undefined;
  const session = (await page.send('Target.attachToTarget', { targetId: frame.targetId, flatten: true })).result?.sessionId;
  const said = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
  return said.result?.result?.value;
}

/** The tip the backdrop's frame shows: what its code says it was given and heard. */
const tipOf = async (page: Page) => String((await inFrame(page, `document.querySelector('.tip')?.textContent ?? ''`)) ?? '');

/** The colour the backdrop shows at the middle of its canvas, read from the canvas its worker paints. */
const shown = (page: Page) => inFrame<number[]>(page, `(() => { const c = document.querySelector('canvas'), t = document.createElement('canvas'); t.width = t.height = 1; const g = t.getContext('2d'); g.drawImage(c, c.width / 2, c.height / 2, 1, 1, 0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data]; })()`);

test('in a browser, a page published with a backdrop runs its layout behind its words and tells it the page', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off', undefined, undefined, packsWith('reader'));
  const words = 'Words.\n\n' + Array.from({ length: 40 }, (_, i) => `- Line ${i + 1}, long enough to wrap onto a second line in the column of words.`).join('\n');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [
    { op: 'create', ref: 'd', type: 'writing', title: 'Home', visibility: 'shared', body: `{l}\n\n${words}` },
    { op: 'create', ref: 's', type: 'layout', title: 'Live land', visibility: 'shared', props: { code: LIVE(`${base}/api/view`) } },
    { op: 'create', ref: 'l', type: 'lens', title: 'The land', visibility: 'shared', body: 'The land.', props: { filter: { find: ['type writing'] } } },
    { op: 'link', type: 'part_of', from: 'l', to: 'd' },
  ] })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.l, props: { style: { style: made.s, numbers: { page_backdrop: 1 } } } }] });
  assert.equal((await call('/api/publish', undefined, { id: made.d })).status, 200);
  const page = await open('about:blank');
  try {
    for (const width of [1280, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 600 });
      await page.go(`${base}/p/default/${made.d}`);
      assert.ok(await page.until(`document.querySelector('body > iframe.page-backdrop.drew') !== null`, 20000), `at ${width} the backdrop has drawn: ${page.logs().join(' / ')}`);
      const at = (await page.evaluate(`(() => { const f = document.querySelector('iframe.page-backdrop'), r = f.getBoundingClientRect(), s = getComputedStyle(f), lens = document.querySelector('.doc-lens'); return { r: [r.left, r.top, r.width, r.height], inner: document.documentElement.clientWidth, position: s.position, z: s.zIndex, main: getComputedStyle([...document.body.children].find((c) => c.contains(document.querySelector('main')))).zIndex, events: s.pointerEvents, room: lens.closest('section').getBoundingClientRect().height }; })()`)) as { r: number[]; inner: number; position: string; z: string; main: string; events: string; room: number };
      assert.ok(at.inner > width - 30, `at ${width} the window is ${at.inner} wide`);
      assert.deepEqual(at.r, [0, 0, at.inner, 800], `at ${width} the frame fills the window`);
      assert.equal(at.position, 'fixed');
      assert.ok(Number(at.z) < Number(at.main), 'the frame is behind the words');
      assert.equal(at.events, 'none', 'the page under it is touched, not the frame');
      assert.equal(at.room, 0, 'the view takes no room on the page: its section, title and words are away');
      // What the layout was given and heard: WebGL2 on an OffscreenCanvas in its worker, no page, no network, the page's numbers.
      let said = '';
      for (let n = 0; n < 100 && !/^\S+ \S+ \S+ \S+ \S+ true [1-9]/.test(said); n++) (said = await tipOf(page)), await new Promise((r) => setTimeout(r, 100));
      const [gl, kind, doc, parent, reached, given, , visible, scroll, clear, pageWidth, viewWidth] = said.split(' ');
      assert.deepEqual([gl, kind, doc, parent, reached, given, visible], ['gl2', 'OffscreenCanvas', 'undefined', 'undefined', 'blocked', 'true', 'true'], said);
      assert.equal(Number(scroll), 0, said);
      assert.ok(Number(clear) >= 1, `the boxes of its words: ${said}`);
      assert.equal(Number(viewWidth), at.inner, said);
      assert.ok(Number(pageWidth) > 0 && Number(pageWidth) <= width, said);
      assert.deepEqual(await shown(page), [255, 0, 255, 255], `at ${width} what its code painted with WebGL2 is shown`);
      // The boxes it is told hold the page's words: the column's lines are in the largest.
      const [x, y, w, h] = said.split(' ').at(-1)!.split(',').map(Number);
      const line = (await page.evaluate(`(() => { const r = [...document.querySelectorAll('main li')].at(-1).getBoundingClientRect(); return [r.left, r.top + scrollY, r.right, r.bottom + scrollY]; })()`)) as number[];
      assert.ok(line[0] >= x - 1 && line[1] >= y - 1 && line[2] <= x + w + 1 && line[3] <= y + h + 1, `the last line ${line} is in the column ${[x, y, w, h]}`);
      // Scrolled, it hears where the page is.
      await page.evaluate(`scrollTo(0, 300)`);
      for (let n = 0; n < 50 && !said.includes(' true 300 '); n++) (said = await tipOf(page)), await new Promise((r) => setTimeout(r, 100));
      assert.match(said, / true 300 /, `it hears the scroll: ${said}`);
      // Hidden, it hears that it is out of sight.
      await page.send('Emulation.setFocusEmulationEnabled', { enabled: false });
      await page.evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }), document.dispatchEvent(new Event('visibilitychange'))`);
      for (let n = 0; n < 50 && !said.includes(' false '); n++) (said = await tipOf(page)), await new Promise((r) => setTimeout(r, 100));
      assert.match(said, / false /, `it hears it is hidden: ${said}`);
    }
  } finally {
    await page.close();
  }
});

// One layout baked as the page's frame (a block of land down its margin), another live as its backdrop, which bakes
// nothing (as the GPU land does) and on a narrow window stops, as code with no WebGL2 would.
const FRAME = `export default function draw({ canvas, style, bake }) {
  const p = style.page ?? { width: canvas.width, height: canvas.height, clear: [] }, ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3f6269';
  for (let y = 0; y < p.height; y += 40) ctx.fillRect(4, y + 4, 32, 32);
  bake('sea');
  bake(null, { every: 5 });
}`;
const GPU = `export default function draw({ canvas, page }) {
  if (page.view.width < 600) throw new Error('No WebGL2 here');
  const gl = canvas.getContext('webgl2');
  gl.clearColor(1, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}`;

test('in a browser, a page with a baked frame and a backdrop shows its frame first, until the backdrop draws, and keeps it where it cannot', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off', undefined, undefined, packsWith('reader'));
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [
    { op: 'create', ref: 'd', type: 'writing', title: 'Home', visibility: 'shared', body: '{f}\n\n{b}\n\nWords for the column.' },
    { op: 'create', ref: 'sf', type: 'layout', title: 'Baked land', visibility: 'shared', props: { code: FRAME } },
    { op: 'create', ref: 'sb', type: 'layout', title: 'Live land', visibility: 'shared', props: { code: GPU } },
    { op: 'create', ref: 'f', type: 'lens', title: 'The frame', visibility: 'shared', body: 'The frame.', props: { filter: { find: ['type writing'] } } },
    { op: 'create', ref: 'b', type: 'lens', title: 'The backdrop', visibility: 'shared', body: 'The backdrop.', props: { filter: { find: ['type writing'] } } },
    { op: 'link', type: 'part_of', from: 'f', to: 'd' },
    { op: 'link', type: 'part_of', from: 'b', to: 'd' },
  ] })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [
    { op: 'update', id: made.f, props: { style: { style: made.sf, numbers: { page_frame: 1, frame_aspect: 2 } } } },
    { op: 'update', id: made.b, props: { style: { style: made.sb, numbers: { page_backdrop: 1 } } } },
  ] });
  const app = await open(`${base}/`);
  try {
    // Only the frame is baked: the backdrop bakes nothing, and is not asked to.
    const { packed, views } = (await app.evaluate(`${pageModule('style-code.js')}.then(async (m) => { const baked = await m.bakeDocument('${made.d}', (id) => fetch('/preview/' + id + '/data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json()).then((r) => r.result)); return { packed: await m.packBaked(baked), views: Object.keys(baked) }; })`)) as { packed: string; views: string[] };
    assert.deepEqual(views, [made.f], 'only the frame is baked');
    assert.equal((await call(`/preview/${made.d}/data`, undefined, { baked: packed })).status, 200);
    assert.equal((await call('/api/publish', undefined, { id: made.d })).status, 200);
  } finally {
    await app.close();
  }
  const page = await open('about:blank');
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.go(`${base}/p/default/${made.d}`);
    assert.ok(await page.until(`document.querySelectorAll('.page-land img').length >= 3`, 10000), 'its baked land is laid first');
    assert.equal(await page.evaluate(`document.getElementById('${made.b}')?.getBoundingClientRect().height`), 0, 'the backdrop takes no room');
    assert.ok(await page.until(`document.querySelector('body > iframe.page-backdrop.drew') !== null && document.querySelector('.page-land').classList.contains('under')`, 20000), 'once the backdrop has drawn, the land under it fades');
    assert.deepEqual(await shown(page), [255, 0, 255, 255], 'and the backdrop is shown');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
    await page.go(`${base}/p/default/${made.d}`);
    assert.ok(await page.until(`document.querySelectorAll('.page-land img').length >= 3 && !document.querySelector('iframe.page-backdrop')`, 20000), 'where its code stops, the backdrop is taken away');
    assert.equal(await page.evaluate(`document.querySelector('.page-land').classList.contains('under')`), false, 'and its baked land stays');
  } finally {
    await page.close();
  }
});
