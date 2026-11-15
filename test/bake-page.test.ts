// A page's frame (task e_ytnw7rk6, e_w7qknp6s): publishing bakes a layout kept on the map around the page's words at
// three widths (packs/walls/page/style-code.js, bakeDocument), keeps each width's top, margins and foot
// (packs/publish/kernel/published-baked.ts), and the published page lays them behind itself (packs/surface/page/doc-lens.js,
// drawFrame). In a real browser (skipped where there is no Chrome).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, pageModule } from './browser.ts';
import { packsWith } from './map.ts';
import { serve } from './serve.ts';

const browser = chrome();

// A drawing that bakes a page: a block of land in every part of the sheet its page leaves open, one look.
const LAND = `export default function draw({ canvas, style, bake }) {
  const p = style.page ?? { width: canvas.width, height: canvas.height, clear: [] }, ctx = canvas.getContext('2d');
  const open = (x, y) => !p.clear.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  ctx.fillStyle = '#3f6269';
  for (let y = 0; y < p.height; y += 20) for (let x = 0; x < p.width; x += 20) if (open(x + 10, y + 10)) ctx.fillRect(x + 2, y + 2, 16, 16);
  bake('sea');
  bake(null, { every: 5 });
}`;

test('in a browser, a page published with its frame baked shows its land behind its words, at any width, its foot under its words', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off', undefined, undefined, packsWith('reader'));
  const words = 'Words.\n\n' + Array.from({ length: 6 }, (_, i) => `- Line ${i + 1}, long enough to wrap onto a second line in the column of words.`).join('\n');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [
    { op: 'create', ref: 'd', type: 'writing', title: 'Home', visibility: 'shared', body: `{l}\n\n${words}` },
    { op: 'create', ref: 's', type: 'layout', title: 'Land', visibility: 'shared', props: { code: LAND } },
    { op: 'create', ref: 'l', type: 'lens', title: 'The land', visibility: 'shared', body: 'The land.', props: { filter: { find: ['type writing'] } } },
    { op: 'link', type: 'part_of', from: 'l', to: 'd' },
  ] })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.l, props: { style: { style: made.s, numbers: { page_frame: 1, frame_aspect: 2 } } } }, { op: 'update', id: made.d, props: { path: 'home' } }] });
  const app = await open(`${base}/`);
  try {
    const packed = (await app.evaluate(`${pageModule('style-code.js')}.then(async (m) => m.packBaked(await m.bakeDocument('${made.d}', (id) => fetch('/preview/' + id + '/data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json()).then((r) => r.result))))`)) as string;
    assert.equal((await call(`/preview/${made.d}/data`, undefined, { baked: packed })).status, 200);
    assert.equal((await call('/api/publish', undefined, { id: made.d })).status, 200);
  } finally {
    await app.close();
  }
  const page = await open('about:blank');
  try {
    for (const width of [1280, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await page.go(`${base}/p/default/${made.d}`);
      assert.ok(await page.until(`[...document.querySelectorAll('.page-land img')].length >= 3 && [...document.querySelectorAll('.page-land img')].every((i) => i.complete && i.naturalWidth > 0)`, 10000), `at ${width} its land is drawn from its baked pictures`);
      const at = (await page.evaluate(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { foot: r('.land-foot').top + scrollY, words: r('main').bottom + scrollY, high: document.documentElement.scrollHeight, frames: document.querySelectorAll('iframe').length }; })()`)) as { foot: number; words: number; high: number; frames: number };
      assert.ok(at.foot >= at.words - 1, `at ${width} the foot band is under the words`);
      assert.ok(at.high < 4000, `at ${width} the page keeps its length`);
      assert.equal(at.frames, 0, 'nothing runs: no frame is started');
    }
  } finally {
    await page.close();
  }
});
