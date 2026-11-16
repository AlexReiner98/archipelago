// The page keeps each answer's picture (task e_vc8nnf8g), in a real browser (skipped where there is no Chrome): a
// canvas gone back to is mounted from the scene its drawing answered before, with no layout run, and so is one on a
// page loaded again, from the browser's storage (task e_7as2t6eq); an answer that changed is laid out as ever, and a
// page whose storage is refused draws as it would without it. The drawing measure (`drawing <id>`, packs/walls/page/layout.js) says which: a kept
// picture is measured with `kept` and took nothing in the drawing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a canvas gone back to or loaded again is not laid out again, and a changed answer is', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'site', type: 'aim', title: 'Site works' },
      { op: 'create', ref: 'roof', type: 'task', title: 'Roof frame' },
      { op: 'create', ref: 'wall', type: 'task', title: 'Wall' },
      { op: 'create', ref: 'beam', type: 'task', title: 'Beam' },
      { op: 'link', type: 'part_of', from: 'roof', to: 'site' },
      { op: 'link', type: 'part_of', from: 'wall', to: 'site' },
      { op: 'link', type: 'depends_on', from: 'roof', to: 'beam' },
    ],
  })).result.created as Record<string, string>;
  const first = `#/v?find=in+${made.site}`;
  const page = await open(`${base}/${first}`);
  const drawn = `[...document.querySelectorAll('#canvas svg a')].map((a) => a.textContent)`;
  const has = (title: string) => `${drawn}.some((t) => t.includes(${JSON.stringify(title)}))`;
  const measures = `performance.getEntriesByType('measure').filter((m) => m.name.startsWith('drawing ')).map((m) => ({ kept: Boolean(m.detail?.kept), drawing: m.detail?.drawing, stored: Boolean(m.detail?.stored) }))`;
  try {
    assert.ok(await page.until(`${has('Wall')} && ${has('Roof frame')}`, 30000), `the canvas is drawn: ${page.logs().join('\n')}`);
    assert.ok(await page.until(`${measures}.length >= 1`), 'its drawing is measured');
    // Another canvas, then back: the first is mounted from what was kept.
    await page.evaluate(`performance.clearMeasures(); location.hash = '#/v?find=type+task'`);
    assert.ok(await page.until(`${has('Beam')} && ${measures}.length >= 1`, 30000), `the second canvas is drawn: ${page.logs().join('\n')}`);
    await page.evaluate(`performance.clearMeasures(); performance.clearMarks('drawing-begun'); history.back()`);
    const back = `${has('Wall')} && !${has('Beam')}`;
    assert.ok(await page.until(`${back} && ${measures}.length >= 1`, 30000), `the first canvas is back: ${await page.evaluate(`JSON.stringify([location.hash, ${drawn}, ${measures}])`)} ${page.logs().join('\n')}`);
    // Nothing more comes: the drawing is not run behind the picture kept.
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(await page.evaluate(measures), [{ kept: true, drawing: 0, stored: false }], 'gone back to, the canvas is mounted from what was kept, with no layout');
    const begun = `performance.getEntriesByName('drawing-begun').length`;
    assert.equal(await page.evaluate(begun), 0, 'its drawing is not started');
    // Asked something (a step hovered), the drawing is started then, and answers.
    await page.evaluate(`document.querySelector('#canvas svg a').dispatchEvent(new MouseEvent('mouseenter'))`);
    assert.ok(await page.until(`${begun} === 1`, 5000), 'hovered, its drawing is started');
    assert.ok(await page.until(`document.querySelector('#canvas .lighting')`, 30000), `and answers the hover: ${page.logs().join('\n')}`);
    await page.evaluate(`document.querySelector('#canvas svg a').dispatchEvent(new MouseEvent('mouseleave'))`);

    // An answer that changed is laid out as ever.
    await page.evaluate('performance.clearMeasures()');
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.wall, title: 'Wall north' }] });
    assert.ok(await page.until(`${has('Wall north')} && ${measures}.length >= 1`, 30000), `the changed answer is drawn: ${page.logs().join('\n')}`);
    assert.deepEqual((await page.evaluate<{ kept: boolean }[]>(measures)).map((m) => m.kept), [false], 'a changed answer is laid out');

    // Loaded again, the page mounts the picture this browser kept, with no layout. Kept when the page is idle: waited for.
    const storedCount = `(async () => {
      if (!(await indexedDB.databases()).some((d) => d.name === 'pelago-pictures')) return 0;
      return new Promise((r) => { const q = indexedDB.open('pelago-pictures'); q.onerror = () => r(0); q.onsuccess = () => { const c = q.result.transaction('names').objectStore('names').count(); c.onsuccess = () => (q.result.close(), r(c.result)); }; });
    })()`;
    assert.ok(await page.until(`${storedCount}.then((n) => n >= 3)`, 15000), `the pictures drawn are kept in this browser: ${await page.evaluate(storedCount)}`);
    const reloaded = async () => {
      await page.send('Page.reload');
      return page.until(`${has('Wall north')} && ${measures}.length >= 1`, 30000);
    };
    assert.ok(await reloaded(), `loaded again, the canvas is drawn: ${page.logs().join('\n')}`);
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(await page.evaluate(measures), [{ kept: true, drawing: 0, stored: true }], 'loaded again, the canvas is mounted from storage, with no layout');
    assert.equal(await page.evaluate(begun), 0, 'and its drawing is not started');

    // Storage refused (a private window, blocked site data): the page lays the canvas out, as it would without it.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('refused', 'SecurityError'); } })" });
    assert.ok(await reloaded(), `with storage refused, the canvas is drawn: ${page.logs().join('\n')}`);
    assert.deepEqual((await page.evaluate<{ kept: boolean }[]>(measures)).map((m) => m.kept), [false], 'with storage refused, it is laid out');
    assert.ok(await page.evaluate(`!document.querySelector('.lens-error')`), 'and nothing stopped');
  } finally {
    await page.close();
  }
});
