// A layout's code baked in the frame it runs in (packs/walls/page/draw.js, bake), in a real browser (skipped where there
// is no Chrome): it answers with its outlines once and each look's colours, walled in as ever. The canvas that records is
// test/bake-record.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

const BAKES = `export default function draw({ canvas, bake }) {
  const ctx = canvas.getContext('2d');
  const aside = new OffscreenCanvas(100, 50), a = aside.getContext('2d');
  let reached = 'nothing';
  try { reached = typeof document + ' ' + typeof parent; } catch {}
  for (const look of ['red', 'blue']) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    a.clearRect(0, 0, 100, 50); a.fillStyle = look; a.fillRect(10, 10, 20, 20);
    ctx.drawImage(aside, 0, 0, 200, 100);
    ctx.fillText(reached, 0, 0);
    bake(look);
  }
  bake(null, { every: 2 });
}`;

test('in a browser, a layout’s code baked in its frame answers with its outlines and each look’s colours, walled in', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/health`);
  try {
    const bakeIt = (code: string) =>
      page.evaluate(`new Promise((resolve) => {
        const f = document.createElement('iframe');
        f.setAttribute('sandbox', 'allow-scripts');
        f.src = '/draw.html';
        addEventListener('message', (ev) => {
          if (ev.source !== f.contentWindow) return;
          if (ev.data.type === 'ready') f.contentWindow.postMessage({ type: 'bake', code: ${JSON.stringify(code)}, answer: { items: [] }, style: {}, theme: {}, width: 200, height: 100 }, '*');
          else if (ev.data.type === 'baked' || ev.data.type === 'error') (f.remove(), resolve(ev.data));
        });
        document.body.append(f);
      })`) as Promise<{ type: string; message?: string; baking?: { shapes: { c: string; d: unknown; s?: string }[]; looks: Record<string, string[]>; timing: { every: number } } }>;
    const said = await bakeIt(BAKES);
    assert.equal(said.type, 'baked', String(said.message));
    const baking = said.baking!;
    assert.deepEqual(Object.keys(baking.looks), ['red', 'blue'], 'its outlines once, and each look its colours');
    assert.deepEqual(baking.looks.red, ['#ff0000', '#000000']);
    assert.deepEqual(baking.looks.blue, ['#0000ff', '#000000']);
    assert.deepEqual(baking.shapes[0].d, [['M', [20, 20]], ['L', [60, 20]], ['L', [60, 60]], ['L', [20, 60]], ['Z']]);
    assert.equal(baking.shapes.at(-1)!.s, 'undefined undefined', 'its code reaches no page');
    assert.equal(baking.timing.every, 2);
    const none = await bakeIt('export default function draw({ canvas }) { canvas.getContext("2d").fillRect(0, 0, 1, 1) }');
    assert.match(String(none.message), /bakes nothing/);
  } finally {
    await page.close();
  }
});
