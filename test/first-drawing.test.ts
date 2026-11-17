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
  // Reads asked together go as one /api/reads (packs/kit/page/reads.js): each is recorded as the read it is.
  const asked = String(url) === '/api/reads' ? (body?.calls ?? []).map((c) => ({ path: '/api/' + c.tool, body: c.input })) : [{ path: String(url), body }];
  const sent = performance.now();
  const reads = asked.map(({ path, body }) => ({ path, name: body?.name, type: body?.type, walk: body?.params?.walk?.over, sent }));
  if (String(url).startsWith('/api/')) window.reads.push(...reads);
  return was(url, init).then((res) => (reads.forEach((r) => (r.back = performance.now())), res));
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
    // The bar fills in after: who is at work is read. (The saved views and find's lens search went with the band and find,
    // decision e_n42s8jvn; the island bar's list is read with the page.)
    const later = (r: any) => (r.path === '/api/view' && r.name === 'sessions') || (r.name === 'flat' && r.walk === 'all');
    assert.ok(await page.until(`window.reads.filter(${later.toString()}).length >= 2`), `what waits is read once the view is drawn: ${JSON.stringify(await page.evaluate('window.reads'))}`);
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
