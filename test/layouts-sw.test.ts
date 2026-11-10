// A pack's own drawing is drawn by a service worker on the drawing host (ui/draw-marks.js, src/drawing-files.ts), which
// the browser keeps between pages: in a real browser (skipped where there is no Chrome), Home's picture is drawn there,
// and a page opened again draws it in the same worker. The walls around it: the service worker reaches no network.
// Code that tries what it may not is test/layouts.test.ts; a drawing kept on the map is never given a service worker
// (test/drawing-files.test.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();
const drawn = `performance.getEntriesByType('measure').some((m) => m.name.startsWith('drawing'))`;

test('in a browser, a pack drawing is drawn by a service worker kept between pages, which reaches no network', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  // Something to draw: two steps, one after the other.
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'work.task', title: 'First' }, { op: 'create', ref: 'b', type: 'work.task', title: 'Then' }, { op: 'link', type: 'depends_on', from: 'b', to: 'a' }] });
  const view = `${base}/#/v?find=type+task`;
  const page = await open(view);
  try {
    assert.ok(await page.until(drawn, 30000), 'the view is drawn');
    const workers = async () => ((await page.send('Target.getTargets')).result.targetInfos as { type: string; url: string; targetId: string }[]).filter((t) => t.type === 'service_worker' && t.url.includes('/drawing/'));
    const [sw] = await workers();
    assert.ok(sw, 'a service worker draws it');
    const at = new URL(sw.url);
    assert.match(at.pathname, /^\/drawing\/[\w-]+\/sw\.js$/);
    assert.notEqual(at.origin, new URL(base).origin, 'on the drawing host, never the page’s origin');

    // Opened again, the page finds the same worker: it is not started anew.
    await page.go(view);
    assert.ok(await page.until(drawn, 30000), 'the view is drawn again');
    const again = await workers();
    assert.deepEqual(again.map((t) => t.targetId), [sw.targetId]);

    // Inside it, nothing reaches the network: not the page's server, not another.
    const session = (await page.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).result.sessionId;
    const tried = await page.send('Runtime.evaluate', { expression: `Promise.all(['${base}/health', '${at.origin}/draw.html', 'https://example.com/'].map((u) => fetch(u).then(() => 'reached', () => 'refused')))`, awaitPromise: true, returnByValue: true }, session);
    assert.deepEqual(tried.result?.result?.value, ['refused', 'refused', 'refused']);
  } finally {
    await page.close();
  }
});
