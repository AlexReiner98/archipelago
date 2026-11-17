// The band under the tabs in a real browser (packs/surface/page/bar-band.js, drawn by canvas.js; Alex, 17 Nov 2026): the
// strip-down that took the query and the saved views out of it left it undrawn, and back and forward went with it. It
// holds the island side bar's button and the pane's back and forward, on one line, at 1280 and at 560 px, and in a
// narrow window the side bar open over the canvas leaves the button in reach.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import { until as holds } from './wait.ts';

const browser = chrome();

test('in a browser, the band under the tabs holds the islands button, back and forward', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  await call('/api/workspace_set', undefined, { islands: true });
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'harbour', type: 'island', title: 'Harbour works', props: { pack: 'core' } }] });
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const press = (label: string) => page.evaluate(`document.querySelector('#query [aria-label="${label}"]').click()`);
  // What the band holds, by name, and whether it stands whole under the tab bar on one line.
  const band = `(() => { const q = document.getElementById('query'), v = q?.querySelector('.q-view'), nav = document.getElementById('nav').getBoundingClientRect(), r = q?.getBoundingClientRect();
    if (!v?.querySelector('button')) return { shown: false };
    return { shown: !q.hidden && r.height > 0, under: r.top >= nav.bottom - 1, line: v.scrollWidth <= v.clientWidth + 1 && v.getBoundingClientRect().height <= v.querySelector('button').getBoundingClientRect().height * 2,
      buttons: [...q.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.firstChild.textContent) }; })()`;
  /** Whether the islands button is the topmost thing where it stands, so a press reaches it. */
  const reachable = `(() => { const b = document.querySelector('#query .isl-toggle').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.isl-toggle') != null; })()`;
  try {
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await until(`the band at ${width} px`, () => page.evaluate<boolean>(`${band}.shown`));
      const got = await page.evaluate<{ shown: boolean; under: boolean; line: boolean; buttons: string[] }>(band);
      assert.deepEqual(got, { shown: true, under: true, line: true, buttons: ['Islands', 'Back', 'Forward'] }, `at ${width} px`);
      assert.ok(await page.evaluate<boolean>(reachable), `the islands button in reach at ${width} px`);
    }
    // Back and forward step the pane through what it drew.
    const was = await page.evaluate<string>('location.hash');
    await page.evaluate(`location.hash = '#/v?islands=elsewhere'`);
    await until('moved', () => page.evaluate<boolean>(`location.hash === '#/v?islands=elsewhere'`));
    await press('Back');
    // Home, however its address was written: the bare page and `#/` are one.
    await until('back', () => page.evaluate<boolean>(`(location.hash || '#/') === ${JSON.stringify(was || '#/')}`));
    await press('Forward');
    await until('forward', () => page.evaluate<boolean>(`location.hash === '#/v?islands=elsewhere'`));
    // Narrow, the side bar opens over the canvas and leaves its button in reach, so a second press puts it away. (It may
    // still be open from the wide window: put away first.)
    await page.evaluate(`document.body.dataset.islands === 'open' && document.querySelector('#query .isl-toggle').click()`);
    await until('folded', () => page.evaluate<boolean>(`document.body.dataset.islands === 'folded'`));
    await page.evaluate(`document.querySelector('#query .isl-toggle').click()`);
    await until('open over the canvas', () => page.evaluate<boolean>(`document.body.dataset.islands === 'open' && document.body.dataset.islandsOver === 'on'`));
    assert.ok(await page.evaluate<boolean>(reachable), 'the islands button in reach over the open side bar');
    await page.evaluate(`document.querySelector('#query .isl-toggle').click()`);
    await until('put away', () => page.evaluate<boolean>(`document.body.dataset.islands === 'folded'`));
  } finally {
    await page.close();
  }
});
