// A mark that edits the canvas query (lane e_nfapxupx, packs/walls/page/marks-find.js), in a real browser (skipped
// where there is no Chrome): a mark with on: ['find'] and find: '<term>' is a button the page answers itself, adding
// the term to the query the canvas draws, and taking it away when it is there, as the page's own filter edits do.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a find mark adds its term to the canvas query and takes it away again', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'work', title: 'Drawn here' }] })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?from=${made.a}`);
  const version = `new URL(document.querySelector('link[href^="/base.js"]').href).search`;
  const finds = `(window.findHooks.address()?.query?.filter?.find ?? [])`;
  try {
    assert.ok(await page.until(`Boolean(document.querySelector('#canvas .lens-view'))`), `the canvas is drawn: ${page.logs().join('\n')}`);
    await page.evaluate(`(async () => {
      const v = ${version};
      const { build } = await import('/marks.js' + v);
      window.findHooks = (await import('/base.js' + v)).hooks;
      const el = build(['button', { key: 'f', on: ['find'], find: '  text   lighthouse ' }], new Map(), () => {});
      el.id = 'finds';
      el.style = 'position: fixed; left: 10px; top: 10px; z-index: 99999';
      document.body.append(el);
    })()`);
    assert.equal(await page.evaluate(`document.getElementById('finds').getAttribute('role')`), 'button', 'the page makes it a button');
    assert.equal(await page.evaluate(`${finds}.includes('text lighthouse')`), false);

    await page.evaluate(`document.getElementById('finds').click()`);
    assert.ok(await page.until(`${finds}.includes('text lighthouse')`), `a click adds the term: ${page.logs().join('\n')}`);
    const before = await page.evaluate<string[]>(finds);
    assert.ok(before.length > 1, 'beside what the query found before');

    await page.evaluate(`document.getElementById('finds').click()`);
    assert.ok(await page.until(`!${finds}.includes('text lighthouse')`), 'a second click takes it away');
    assert.deepEqual(await page.evaluate<string[]>(finds), before.filter((t) => t !== 'text lighthouse'), 'and leaves the rest');

    assert.match(await page.evaluate<string>(`import('/marks.js' + ${version}).then(({ build }) => { try { build(['button', { key: 'g', on: ['find'], find: '   ' }], new Map(), () => {}); return 'made'; } catch (e) { return e.message; } })`), /the term/, 'a term of no words is refused');
  } finally {
    await page.close();
  }
});
