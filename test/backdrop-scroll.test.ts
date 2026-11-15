// A backdrop that scrolls with its page (packs/walls/page/backdrop.js, draw-scroll.js): code that draws a margin above
// and below the window and says where on the page its canvas's top stands (drawn(top)) is shown there, in a frame as
// tall as the page that the browser scrolls with the words. Its land then moves with them though it draws nothing new.
// In a real browser (skipped where there is no Chrome).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { chrome, open, type Page } from './browser.ts';
import { packsWith } from './map.ts';
import { serve } from './serve.ts';

const browser = chrome();

// Draws once, at the page it was handed: a magenta bar at page height 600 down the left edge, then never again.
const ONCE = `export default function draw({ canvas, page, drawn }) {
  const m = page.margin, top = page.scroll - m, g = canvas.getContext('2d');
  canvas.width = page.view.width;
  canvas.height = page.view.height + 2 * m;
  g.fillStyle = '#ff00ff';
  g.fillRect(0, 600 - top, 40, 20);
  drawn(top);
}`;

/** A PNG's pixels: 8-bit RGB or RGBA, not interlaced (what Chrome's screencast gives). */
function png(buf: Buffer) {
  let at = 8, w = 0, h = 0, ch = 4;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), type = buf.toString('ascii', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') ((w = data.readUInt32BE(0)), (h = data.readUInt32BE(4)), (ch = data[9] === 6 ? 4 : 3));
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[y * stride + x] = (row[x] + pr) & 255;
    }
  }
  return { w, h, at: (x: number, y: number) => [...px.subarray(y * stride + x * ch, y * stride + x * ch + 3)] };
}

/** The rows of the window, as shown, where the bar's magenta is at its left edge. */
async function bar(page: Page): Promise<number[]> {
  const img = png(Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  const rows: number[] = [];
  for (let y = 0; y < img.h; y++) { const [r, g, b] = img.at(10, y); if (r > 200 && g < 80 && b > 200) rows.push(y); }
  return rows.length ? [rows[0], rows.at(-1)!] : [];
}

test('in a browser, a backdrop that says where it drew scrolls with the page, though it draws nothing new', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off', undefined, undefined, packsWith('reader'));
  const words = 'Words.\n\n' + Array.from({ length: 80 }, (_, i) => `- Line ${i + 1}, long enough to wrap onto a second line in the column of words.`).join('\n');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [
    { op: 'create', ref: 'd', type: 'writing', title: 'Home', visibility: 'shared', body: `{l}\n\n${words}` },
    { op: 'create', ref: 's', type: 'layout', title: 'Land drawn once', visibility: 'shared', props: { code: ONCE } },
    { op: 'create', ref: 'l', type: 'lens', title: 'The land', visibility: 'shared', body: 'The land.', props: { filter: { find: ['type writing'] } } },
    { op: 'link', type: 'part_of', from: 'l', to: 'd' },
  ] })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.l, props: { style: { style: made.s, numbers: { page_backdrop: 1 } } } }] });
  assert.equal((await call('/api/publish', undefined, { id: made.d })).status, 200);
  const page = await open('about:blank');
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.go(`${base}/p/default/${made.d}`);
    assert.ok(await page.until(`document.querySelector('body > iframe.page-backdrop.drew.scrolls') !== null`, 20000), `the backdrop scrolls with the page: ${page.logs().join(' / ')}`);
    const at = (await page.evaluate(`(() => { const f = document.querySelector('iframe.page-backdrop'), s = getComputedStyle(f); return { position: s.position, height: f.getBoundingClientRect().height, page: document.documentElement.scrollHeight, events: s.pointerEvents }; })()`)) as { position: string; height: number; page: number; events: string };
    assert.equal(at.position, 'absolute');
    assert.equal(at.height, at.page, 'the frame is as tall as the page, and makes it no taller');
    assert.ok(at.page > 2000, `the page is long: ${at.page}`);
    assert.equal(at.events, 'none');
    for (let n = 0; n < 50 && (await bar(page)).length === 0; n++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await bar(page), [600, 619], 'the bar stands at page height 600');
    // Scrolled, the bar moves with the words, by the browser's scrolling alone: the code drew once.
    await page.evaluate(`scrollTo(0, 300)`);
    await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    assert.deepEqual(await bar(page), [300, 319], 'at scroll 300 the bar is 300 down the window');
    await page.evaluate(`scrollTo(0, 500)`);
    await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    assert.deepEqual(await bar(page), [100, 119], 'at scroll 500 the bar is 100 down the window');
  } finally {
    await page.close();
  }
});
