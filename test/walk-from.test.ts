// An item's page offers, one click further, to draw what the item relates to (decision e_jedng69e), in a real browser
// (skipped where there is no Chrome): a click on a node opens its page and leaves the lens alone; Walk from it draws the
// item and one step along the links it has, in place of the lens; the same in its menu adds them to the lens.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, an item page walks from the item, in place of the lens or added to it', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'task', title: 'Pour the slab' },
      { op: 'create', ref: 'b', type: 'task', title: 'Dig the footings' },
      { op: 'create', ref: 'c', type: 'task', title: 'Order the steel' },
      { op: 'create', ref: 'd', type: 'task', title: 'Find a supplier' },
      { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
      { op: 'link', type: 'depends_on', from: 'c', to: 'd' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?ids=${made.a},${made.c}`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(150)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const drawn = (id: string) => `Boolean(document.querySelector('#canvas .pane-canvas svg a[href="#/e/${id}"]'))`;
  const click = (id: string) => page.evaluate(`document.querySelector('#canvas .pane-canvas svg a[href="#/e/${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))`);
  const lens = `new URLSearchParams(location.hash.split('?')[1] ?? '')`;
  try {
    assert.ok(await until(`${drawn(made.a)} && ${drawn(made.c)}`), `the lens is drawn: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate(drawn(made.b))), 'what it links to is not drawn yet');
    // A click opens its page and leaves the lens alone.
    await click(made.a);
    assert.ok(await until(`document.body.dataset.sheet === 'open' && location.hash.startsWith('#/e/${made.a}?') && Boolean(document.querySelector('#sheet .walk-from'))`), `its page is open, with Walk from it: ${await page.evaluate('location.hash')}`);
    assert.ok(!(await page.evaluate(drawn(made.b))), 'opening it draws nothing more');
    // Walk from it: the item and a step along its links, in place of the lens; its page stays open.
    await page.evaluate(`document.querySelector('#sheet .walk-from').click()`);
    assert.ok(await until(`${drawn(made.a)} && ${drawn(made.b)} && !${drawn(made.c)}`), `the item and what it links to, in place of the lens: ${await page.evaluate('location.hash')}`);
    assert.ok(await page.evaluate(`location.hash.startsWith('#/e/${made.a}?') && ${lens}.get('over') === 'depends_on' && ${lens}.get('ids') === '${made.a}'`), `the walk named by the link it has: ${await page.evaluate('location.hash')}`);
    assert.ok(await until(`document.querySelector('#find-lens').textContent.includes('Walk')`), 'the query line says the walk');
    // Back to both, then from the other's page, added to the lens.
    await page.evaluate(`document.querySelector('#query [aria-label="Back"]').click()`);
    assert.ok(await until(`${drawn(made.c)} && !${drawn(made.b)}`), 'back to the lens as it was');
    await click(made.c);
    assert.ok(await until(`location.hash.startsWith('#/e/${made.c}?') && Boolean(document.querySelector('#sheet .walk-from'))`), 'the other’s page is open');
    await page.evaluate(`[...document.querySelectorAll('#sheet .menu-items button')].find((b) => b.textContent === 'Walk from it, added to the lens').click()`);
    assert.ok(await until(`${drawn(made.a)} && ${drawn(made.c)} && ${drawn(made.d)} && ${drawn(made.b)}`), `added to the lens, the walk taken from every seed: ${await page.evaluate('location.hash')}`);
  } finally {
    page.close();
  }
});
