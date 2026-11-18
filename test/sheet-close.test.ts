// The sheet's × shuts it (task e_x94xu6ut, the owner, 18 Nov 2026): an item opened by its own address drew its island
// under it, the pane then stood at that item's address, and × went back to it, opening the item again. Opened from an
// agent's show (islands= in the address) or from a link to the item alone, × shuts the sheet and leaves the canvas.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import { until as holds } from './wait.ts';

const browser = chrome();

test('in a browser, × shuts an item opened from a show or a link', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  await call('/api/workspace_set', undefined, { islands: true });
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'harbour', type: 'island', title: 'Harbour works', props: { pack: 'core' } },
      { op: 'create', ref: 'pier', type: 'task', title: 'Rebuild the pier', props: { island: '{harbour}' } },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const open_ = () => page.evaluate<boolean>(`document.body?.dataset.sheet === 'open'`);
  const draws = (words: string) => page.evaluate<boolean>(`document.querySelector('#canvas svg')?.textContent.includes(${JSON.stringify(words)}) ?? false`);
  /** Open the page at `hash` fresh, see the sheet and the canvas under it, press ×, and see it shut and stay shut. */
  const closes = async (hash: string, drawn: string) => {
    await page.evaluate(`(location.hash = ${JSON.stringify(hash)}, location.reload())`);
    await until(`${hash}: the sheet opens`, open_);
    await until(`${hash}: the canvas draws under it`, () => draws(drawn));
    await page.evaluate(`document.getElementById('sheet-close').click()`);
    await until(`${hash}: × shuts the sheet`, async () => !(await open_()));
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await open_(), false, `${hash}: the sheet stays shut`);
    assert.doesNotMatch(await page.evaluate<string>(`location.hash`), /^#\/e\//, `${hash}: the address names no item`);
    assert.ok(await draws(drawn), `${hash}: the canvas still draws what it drew`);
  };
  try {
    // An agent's show that opens an item over its islands.
    await closes(`#/e/${made.pier}?islands=${made.harbour}`, 'Rebuild the pier');
    // A link to the item alone: its island is drawn under it.
    await closes(`#/e/${made.pier}`, 'Rebuild the pier');
  } finally {
    await page.close();
  }
});
