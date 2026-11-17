// The page answers a narrowing edit itself first (task e_hygj7ybc), in a real browser (skipped where there is no
// Chrome): with the server's answer held back, taking Only's words in find draws the canvas narrowed at once, from what
// the page holds and what find heard of the words; the server's answer then lands on that drawing without drawing it again.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AT_ONCE, chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import * as F from './find-dom.ts';

const browser = chrome();
/** How long the server's answers are held back once Only is pressed: what is drawn before then is the page's own. */
const HELD = AT_ONCE * 4;

test('in a browser, Only a word draws at once, and the server\'s answer lands on it', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'site', type: 'aim', title: 'Site works' },
      { op: 'create', ref: 'roof', type: 'task', title: 'Roof frame' },
      { op: 'create', ref: 'wall', type: 'task', title: 'Wall' },
      { op: 'create', ref: 'tiles', type: 'task', title: 'Tiles' },
      { op: 'link', type: 'part_of', from: 'roof', to: 'site' },
      { op: 'link', type: 'part_of', from: 'wall', to: 'site' },
      { op: 'link', type: 'part_of', from: 'tiles', to: 'site' },
      // A step of the walk from the roof: kept, as the server keeps it.
      { op: 'create', ref: 'beam', type: 'task', title: 'Beam' },
      { op: 'link', type: 'depends_on', from: 'roof', to: 'beam' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?find=in+${made.site}&over=depends_on&steps=1&shape=flow`);
  const drawn = `[...document.querySelectorAll('#canvas svg a')].map((a) => a.textContent)`;
  const has = (title: string) => `${drawn}.some((t) => t.includes(${JSON.stringify(title)}))`;
  const marks = `performance.getEntriesByType('mark').map((m) => m.name)`;
  try {
    assert.ok(await page.until(`${has('Wall')} && ${has('Beam')}`), `the canvas is drawn: ${page.logs().join('\n')}`);
    // The canvas's own read of the narrowed query held back, and once Only is pressed every answer from the server, so
    // what is drawn first can only be the page's.
    await page.evaluate(`(() => {
      const real = window.fetch;
      window.fetch = (url, init) => (window.holding || (typeof init?.body === 'string' && init.body.includes('text roof') && init.body.includes('"follow":true'))
        ? new Promise((r) => setTimeout(r, ${HELD})).then(() => real(url, init)) : real(url, init));
      window.stages = 0;
      new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('.lf-stage') || n.querySelector?.('.lf-stage'))) window.stages++; })
        .observe(document.getElementById('canvas'), { childList: true, subtree: true });
    })()`);
    await page.evaluate(F.type('only roof'));
    // Find asks what the words would leave out of what is drawn, and says it beside them.
    const words = F.choice('Words', '“roof”');
    assert.ok(await page.until(`(${F.said(words)})?.notes.some((n) => n.startsWith('−'))`), `the words are offered with what they leave out: ${await page.evaluate(`JSON.stringify(${F.saidAll})`)}`);
    await page.evaluate(`performance.clearMarks(); window.stages = 0; window.holding = true`);
    assert.ok(await page.evaluate(F.press('Words', '“roof”')));
    assert.ok(await page.until(`!${has('Wall')} && ${has('Roof frame')} && ${has('Beam')}`, AT_ONCE * 3), `drawn narrowed before the server answered: ${await page.evaluate(`JSON.stringify(${drawn})`)} ${page.logs().join('\n')}`);
    // The picture on screen narrowed first (packs/walls/page/narrow-picture.js), then laid out anew.
    assert.deepEqual(await page.evaluate(`${marks}.filter((m) => m.startsWith('lens-'))`), ['lens-edit', 'lens-narrowed', 'lens-narrow-shown'], 'the page drew it, and the server has not answered yet');
    const took = await page.evaluate(`Math.round(performance.getEntriesByName('lens-narrowed')[0].startTime - performance.getEntriesByName('lens-edit')[0].startTime)`);
    assert.ok(Number(took) < AT_ONCE, `the narrowed answer is worked out at once, waiting on no answer from the server (${took} ms)`);
    // The server's answer agrees: it lands without the drawing being drawn again.
    assert.ok(await page.until(`${marks}.includes('lens-confirmed')`, HELD + 5000), `the server's answer lands: ${page.logs().join('\n')}`);
    // Two stages come: the picture there was, handed to the canvas drawn for the edit and narrowed, then the page's
    // layout of its answer. The server's answer brings none.
    assert.equal(await page.evaluate('window.stages'), 2, 'drawn once, by the page');
    assert.ok(await page.evaluate(`!${has('Wall')} && ${has('Roof frame')}`));
  } finally {
    await page.close();
  }
});
