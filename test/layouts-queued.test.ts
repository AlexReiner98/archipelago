// Pictures of one drawing are drawn by one worker, one after another (ui/draw-marks.js): a picture finished is the
// worker answering, so pictures queued behind each other are each given the page's twelve seconds, and are not stopped
// for what took long before them (bug: "How is Archipelago built, and why?" stopped, 7 Nov 2026). Code that never
// answers is still stopped (test/layouts.test.ts). In a real browser, skipped where there is no Chrome.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { house } from './layout-cases.ts';
import { serve } from './serve.ts';

const browser = chrome();
const numbers = JSON.stringify(house('flow').numbers);

test('in a browser, three pictures of five seconds each, asked at once, all draw', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    // Each picture holds its worker five seconds: fifteen in all, past the twelve a silent worker is given.
    const slow = `export async function picture() { const end = Date.now() + 5000; while (Date.now() < end); return { scene: { message: 'drawn' } }; }`;
    const said = await page.evaluate(`(async () => {
      const { drawWith } = await import('/layout.js');
      const hosts = [0, 1, 2].map(() => { const host = document.createElement('div'); document.body.append(host); return host; });
      for (const host of hosts) drawWith(host, { items: [], links: [], lens: {} }, { numbers: ${numbers}, drawing: { hash: 'queued'.padEnd(64, '0'), modules: { 'index.js': ${JSON.stringify(slow)} } } }, () => {});
      for (let n = 0; n < 1000 && hosts.some((h) => !h.textContent); n++) await new Promise((r) => setTimeout(r, 25));
      return hosts.map((h) => h.textContent);
    })()`);
    assert.deepEqual(said, ['drawn', 'drawn', 'drawn']);
  } finally {
    await page.close();
  }
});
