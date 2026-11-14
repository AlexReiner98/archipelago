// A view's page reaches its drawing first, in a real browser (skipped where there is no Chrome): the server answers one
// read at a time, so what the drawing does not need (who is at work, the saved views, the layouts to switch to, what
// is around the answer) is asked for only once the view is drawn; and the drawing runs in the frame the page itself
// starts (ui/index.html), loading while the page's modules are, not one made when the canvas is.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

/** Each call the page makes to /api, in order: what it asked and when it was sent and answered. */
const RECORD = `{ window.reads = []; const was = window.fetch; window.fetch = (url, init) => {
  const body = (() => { try { return JSON.parse(init?.body ?? 'null'); } catch { return null; } })();
  const read = { path: String(url), name: body?.name, type: body?.type, walk: body?.params?.walk?.over, sent: performance.now() };
  if (String(url).startsWith('/api/')) window.reads.push(read);
  return was(url, init).then((res) => ((read.back = performance.now()), res));
}; }`;

test('in a browser, a view is read and drawn before what the drawing does not need', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'task', title: 'Second step' },
      { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    ],
  })).result.created as Record<string, string>;
  const page = await open('about:blank');
  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORD });
    await page.go(`${base}/#/v?find=id+${made.a}&over=depends_on&steps=1`);
    assert.ok(await page.until(`[...document.querySelectorAll('#canvas svg a')].some((a) => a.textContent.includes('Second step'))`), `the view is drawn: ${page.logs().join('\n')}`);
    // The bar fills in after: the saved views and who is at work are read. The layouts are read only as the band's menu
    // opens (the styles pack's layout switch).
    const later = (r: any) => (r.path === '/api/view' && ['sessions', 'saved_views'].includes(r.name)) || (r.path === '/api/search' && r.type === 'lens') || (r.name === 'flat' && r.walk === 'all');
    assert.ok(await page.until(`window.reads.filter(${later.toString()}).length >= 4`), `what waits is read once the view is drawn: ${JSON.stringify(await page.evaluate('window.reads'))}`);
    const reads = await page.evaluate<any[]>('window.reads');
    const view = reads.find((r) => r.name === 'flat' && r.walk !== 'all');
    assert.ok(view?.back, 'the view is read');
    const drawn = await page.evaluate<number>(`performance.getEntriesByType('measure').find((m) => m.name.startsWith('drawing')).toJSON().startTime + performance.getEntriesByType('measure').find((m) => m.name.startsWith('drawing')).duration`);
    for (const r of reads.filter(later)) assert.ok(r.sent >= drawn - 1, `${r.name ?? r.type} is asked for after the view is drawn (${Math.round(r.sent)} ms, drawn at ${Math.round(drawn)} ms)`);
    // One frame for every drawing: the one the page started with.
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('iframe.drawing-sandbox')].map((f) => f.parentElement.tagName)`), ['BODY']);
  } finally {
    await page.close();
  }
});
