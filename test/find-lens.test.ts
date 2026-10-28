// Finding through the bar, in a real browser (skipped where there is no Chrome): the find bar sets the words of the
// canvas's lens. Typing says what the words would find in one line (how many, the first names); Enter puts them in
// place of the words the bar set before, the rest of the lens kept; Shift+Enter adds them as another set, found as
// well (e_e3k797d3); clearing the bar takes the words out, and back brings them again. No list of rows is drawn. At 1280 and at 560 px, the line never wraps.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, the find bar sets the text of the canvas lens', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'site', type: 'project', title: 'Site works' },
      { op: 'create', ref: 'roof', type: 'task', title: 'Roof the shed' },
      { op: 'create', ref: 'walls', type: 'task', title: 'Walls', body: 'Up before the roof goes on.' },
      { op: 'create', ref: 'gutter', type: 'task', title: 'Gutters' },
      { op: 'create', ref: 'other', type: 'task', title: 'Elsewhere' },
      { op: 'link', type: 'part_of', from: 'roof', to: 'site' },
      { op: 'link', type: 'part_of', from: 'walls', to: 'site' },
      { op: 'link', type: 'depends_on', from: 'gutter', to: 'roof' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?ids=${made.other}&over=part_of,depends_on&steps=1`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(150)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const drawn = `[...document.querySelectorAll('#canvas svg a')].map((a) => a.textContent)`;
  const has = (title: string) => `${drawn}.some((t) => t.includes(${JSON.stringify(title)}))`;
  const type = (q: string) => page.evaluate(`(() => { const i = document.querySelector('#find input'); i.focus(); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  // Enter, or with Shift held to add what the words find.
  const enter = (shift = false) => page.evaluate(`(() => { document.querySelector('#find input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: ${shift}, bubbles: true })); document.querySelector('#find').requestSubmit(); })()`);
  const peek = `document.querySelector('#find .find-peek')`;
  const shots = process.env.PELAGO_SHOTS;
  try {
    assert.ok(await until(has('Elsewhere')), `the canvas is drawn: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate(has('Roof the shed'))), 'what is not found is not drawn yet');
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await type('roof');
      assert.ok(await until(`!${peek}.hidden && ${peek}.textContent.includes('Roof the shed')`), `typing says what it would find: ${page.logs().join('\n')}`);
      const line = await page.evaluate<{ count: string; names: string; tall: number; row: number; wide: boolean }>(`(() => { const p = ${peek}; const r = document.querySelector('#find .find-row'); return { count: p.querySelector('.count').textContent, names: p.querySelector('.gist').textContent, tall: p.getBoundingClientRect().height, row: r.getBoundingClientRect().height, wide: p.getBoundingClientRect().right <= innerWidth }; })()`);
      assert.equal(line.count, '2', 'how many the words find');
      assert.equal(line.names, 'Roof the shed · Walls', 'the first names, best first');
      assert.ok(line.tall <= line.row, `one line at ${width} px (${line.tall} against the bar's ${line.row})`);
      assert.ok(line.wide, `inside the page at ${width} px`);
      assert.equal(await page.evaluate(`document.querySelectorAll('#find ul, #find li').length`), 0, 'no list of rows');
      if (shots) writeFileSync(`${shots}/find-peek-${width}.png`, await page.screenshot());
      // Enter sets the words, every other term and the walk kept.
      await enter();
      assert.ok(await until(`location.hash.includes('text=roof') && ${has('Roof the shed')} && ${has('Site works')} && ${has('Gutters')}`), `Enter finds the words, the walk kept: ${await page.evaluate(`JSON.stringify(${drawn})`)} ${page.logs().join('\n')}`);
      assert.ok(await page.evaluate(has('Elsewhere')), 'the rest of the lens stays');
      assert.ok(await until(`document.querySelector('#query .q-sum')?.textContent.startsWith('Find“roof”or')`), 'the query bar says the words as a Find term, joined by or');
      assert.ok(await page.evaluate(`${peek}.hidden`), 'the line goes once it is drawn');
      if (shots) writeFileSync(`${shots}/find-drawn-${width}.png`, await page.screenshot());
      // Enter again puts new words in place of those the bar set, and nothing else.
      await type('walls');
      await enter();
      assert.ok(await until(`location.hash.includes('text=walls') && !location.hash.includes('text=roof') && ${has('Walls')} && ${has('Elsewhere')} && !${has('Roof the shed')}`), `Enter replaces only the words: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
      // Shift+Enter adds a set of words: both are found.
      await type('gutters');
      await enter(true);
      assert.ok(await until(`location.hash.includes('text=walls') && location.hash.includes('text=gutters') && ${has('Walls')} && ${has('Gutters')} && ${has('Elsewhere')}`), `Shift+Enter keeps both sets: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
      assert.ok(await until(`document.querySelector('#query .q-sum')?.textContent.includes('“walls”or“gutters”')`), 'each set its own Find term');
      // Clearing the bar takes the words out, and back brings them again.
      await type('');
      await enter();
      assert.ok(await until(`!location.hash.includes('text=') && !${has('Walls')} && ${has('Elsewhere')}`), `cleared, the words are out and the rest is drawn: ${await page.evaluate(`JSON.stringify(${drawn})`)} ${page.logs().join('\n')}`);
      await page.evaluate(`document.querySelector('#query [aria-label="Back"]').click()`);
      assert.ok(await until(`location.hash.includes('text=walls') && location.hash.includes('text=gutters') && ${has('Walls')}`), `back draws the words again: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
      // Out again for the next width.
      await type('');
      await enter();
      assert.ok(await until(`!location.hash.includes('text=') && ${has('Elsewhere')} && !${has('Walls')}`), 'cleared for the next width');
    }
    // The bar shows the lens's text when an address carries one.
    await page.evaluate(`document.activeElement.blur()`);
    await page.go(`${base}/#/v?ids=${made.other}&text=gutters`);
    assert.ok(await until(`document.querySelector('#find input').value === 'gutters'`), 'the bar shows the text of the lens up');
  } finally {
    page.close();
  }
});
