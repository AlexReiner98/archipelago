// The narrowing terms in the query bar, in a real browser (skipped where there is no Chrome): an address that narrows
// (only a type, within an item) draws only what holds, and find (the query's line and rows) shows each in its Only row, apart from what Find
// finds (decision e_drt4g872). Find's box takes `only <type>` and `within <id>`; a term's × takes the narrowing out. At
// 1280 and at 560 px, the bar stays one line.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, the query bar shows what narrows in its Only row', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'site', type: 'project', title: 'Site works' },
      { op: 'create', ref: 'roof', type: 'feature', title: 'Roof' },
      { op: 'create', ref: 'which', type: 'question', title: 'Which tiles?' },
      { op: 'create', ref: 'gutter', type: 'task', title: 'Gutters' },
      { op: 'create', ref: 'away', type: 'question', title: 'Elsewhere?' },
      { op: 'link', type: 'part_of', from: 'roof', to: 'site' },
      { op: 'link', type: 'part_of', from: 'which', to: 'roof' },
      { op: 'link', type: 'part_of', from: 'gutter', to: 'roof' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?types=question&within=${made.site}`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(150)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const drawn = `[...document.querySelectorAll('#canvas svg a')].map((a) => a.textContent)`;
  const has = (title: string) => `${drawn}.some((t) => t.includes(${JSON.stringify(title)}))`;
  // The Only row's terms in sight, then those beyond what fits, which its "+N more" names.
  const chips = `[...[...document.querySelectorAll('#find .q-only .q-narrow .q-said')].map((c) => c.textContent), ...(document.querySelector('#find .q-only .q-more:not([hidden])')?.title.split(' · ') ?? [])]`;
  // Picked in a row's menu, opened from its +: a kind, then the thing (decision e_45sgrfqd); nothing is written to be guessed.
  const pick = (plus: string, ...path: string[]) => page.evaluate(`(async () => { document.querySelector('#find [aria-label=${JSON.stringify(plus)}]').click(); for (const label of ${JSON.stringify(path)}) { await new Promise((r) => setTimeout(r, 50)); [...document.querySelectorAll('.term-pick .term-pick-item')].find((b) => b.textContent === label).click(); } })()`);
  const shots = process.env.PELAGO_SHOTS;
  try {
    assert.ok(await until(has('Which tiles?')), `the narrowed canvas is drawn: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate(has('Elsewhere?'))), 'a question outside the project is not');
    assert.ok(await until(`${chips}.join('|') === 'within Site works'`), `within is in the Only row, by the item's name: ${await page.evaluate(`JSON.stringify(${chips})`)} ${page.logs().join('\n')}`);
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#find .q-type .q-said')].map((c) => c.textContent)`), ['Question'], 'what Find finds stays apart');
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      // The query is one row under the view's: nothing in it wraps onto a second line.
      const tall = await page.evaluate<{ bar: number; part: number }>(`(() => { const row = document.querySelector('#find .q-lens'); return { bar: row.scrollHeight, part: row.clientHeight }; })()`);
      assert.ok(tall.bar <= tall.part + 1, `one line at ${width} px (${tall.bar} against ${tall.part})`);
      if (shots) writeFileSync(`${shots}/narrow-bar-${width}.png`, await page.screenshot());
    }
    await page.send('Emulation.clearDeviceMetricsOverride');
    // The box narrows: more types found, then only one of them.
    await pick('Find more', 'Type', 'Task');
    assert.ok(await until(`${has('Gutters')} && ${has('Which tiles?')}`), `a type more is found within it: ${page.logs().join('\n')}`);
    await pick('Only what is so, of a type, or within an item', 'Type', 'Task');
    assert.ok(await until(`location.hash.includes('only=task') && ${has('Gutters')} && !${has('Which tiles?')}`), `only narrows what is found: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
    assert.ok(await until(`${chips}.join('|') === 'Task|within Site works'`), `each narrowing a term of Only: ${await page.evaluate(`JSON.stringify(${chips})`)}`);
    // Its × takes it out, and what it held back is drawn again.
    await page.evaluate(`[...document.querySelectorAll('#find .q-narrow')].find((c) => !c.textContent.includes('within')).querySelector('.q-x').click()`);
    assert.ok(await until(`!location.hash.includes('only=') && ${has('Which tiles?')}`), 'taken out, it narrows no more');
    await page.evaluate(`[...document.querySelectorAll('#find .q-narrow')].find((c) => c.textContent.includes('within')).querySelector('.q-x').click()`);
    assert.ok(await until(`!location.hash.includes('within=') && ${has('Elsewhere?')}`), 'nor within');
  } finally {
    page.close();
  }
});
