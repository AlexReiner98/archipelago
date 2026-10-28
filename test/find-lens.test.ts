// Finding through the bar, in a real browser (skipped where there is no Chrome): the find bar sets the text of the
// canvas's lens. Typing says what the words would find in one line (how many, the first names); Shift+Enter adds it to
// the canvas with what it is tied to, Enter draws it in place, back undoes that; clearing the bar takes the term out. No list of
// rows is drawn. At 1280 and at 560 px, the line never wraps.

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
  // Enter, or with Shift held to add to what is drawn.
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
      await enter(true);
      assert.ok(await until(`location.hash.includes('text=roof') && ${has('Roof the shed')} && ${has('Site works')} && ${has('Gutters')}`), `Shift+Enter draws what is found, with what it is tied to: ${await page.evaluate(`JSON.stringify(${drawn})`)} ${page.logs().join('\n')}`);
      assert.ok(await page.evaluate(has('Elsewhere')), 'added: what was drawn stays');
      assert.ok(await until(`[...document.querySelectorAll('#query .q-text, #query .q-more')].some((c) => (c.textContent + c.title).includes('roof'))`), 'the query bar shows the term, in sight or among the rest of its part');
      assert.ok(await page.evaluate(`${peek}.hidden`), 'the line goes once it is drawn');
      if (shots) writeFileSync(`${shots}/find-drawn-${width}.png`, await page.screenshot());
      // Clearing the bar takes the term out.
      await type('');
      await enter();
      // Waited for together: between the two pictures the canvas holds none, and neither is drawn.
      assert.ok(await until(`!location.hash.includes('text=') && !${has('Roof the shed')} && ${has('Elsewhere')}`), `cleared, the term is out and what was there before is drawn: ${await page.evaluate(`JSON.stringify(${drawn})`)} ${page.logs().join('\n')}`);
      // Enter draws what is found in place of what was drawn (decision e_c3g6gwqq), and back brings that again.
      await type('roof');
      await enter();
      assert.ok(await until(`location.hash.includes('text=roof') && ${has('Roof the shed')} && !${has('Elsewhere')}`), `Enter replaces what was drawn: ${await page.evaluate(`JSON.stringify(${drawn})`)} ${page.logs().join('\n')}`);
      await page.evaluate(`document.querySelector('#query [aria-label="Back"]').click()`);
      assert.ok(await until(`!location.hash.includes('text=') && ${has('Elsewhere')} && !${has('Roof the shed')}`), `back draws what was there before: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
    }
    // The bar shows the lens's text when an address carries one.
    await page.evaluate(`document.activeElement.blur()`);
    await page.go(`${base}/#/v?ids=${made.other}&text=gutters`);
    assert.ok(await until(`document.querySelector('#find input').value === 'gutters'`), 'the bar shows the text of the lens up');
  } finally {
    page.close();
  }
});
