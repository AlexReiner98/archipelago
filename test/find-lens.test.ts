// Finding through the bar, in a real browser (skipped where there is no Chrome): find at the canvas's foot is the
// query's (decision e_2a4mddx8). Typing lists what the words could be, each choice said by its kind, Words first and
// lit, with how many they find (decision e_45sgrfqd); Enter puts the words in place of the words find set before, the
// rest of the lens kept; Shift+Enter adds them as another set, found as well (e_e3k797d3); a term's × in find's rows
// takes the words out, and back brings them again. At rest find says the lens in one line. At 1280 and at 560 px, no
// choice wraps.

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
  const type = (q: string) => page.evaluate(`(() => { const i = document.querySelector('#find input[type=search]'); i.focus(); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  // Enter, or with Shift held to add what the words find.
  const enter = (shift = false) => page.evaluate(`(() => { document.querySelector('#find input[type=search]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: ${shift}, bubbles: true })); document.querySelector('#find').requestSubmit(); })()`);
  // A set of words taken out by its × in find's Find row.
  const out = (w: string) => page.evaluate(`document.querySelector('#find [aria-label="Take out “${w}”"]')?.click()`);
  const list = `document.querySelector('#find .find-choices')`;
  const shots = process.env.PELAGO_SHOTS;
  try {
    assert.ok(await until(has('Elsewhere')), `the canvas is drawn: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate(has('Roof the shed'))), 'what is not found is not drawn yet');
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await type('roof');
      assert.ok(await until(`!${list}.hidden && ${list}.textContent.includes('Roof the shed') && ${list}.textContent.includes('found')`), `typing lists what the words could be: ${page.logs().join('\n')}`);
      const seen = await page.evaluate<{ first: string; lit: boolean; count: string; kinds: string[]; tall: number; row: number; wide: boolean }>(`(() => { const l = ${list}; const c = [...l.querySelectorAll('.find-choice')]; const r = document.querySelector('#find .find-row'); return { first: c[0].querySelector('.find-name').textContent, lit: c[0].classList.contains('lit'), count: c[0].querySelector('.find-note')?.textContent ?? '', kinds: c.map((x) => x.querySelector('.q-label').textContent), tall: Math.max(...c.map((x) => x.getBoundingClientRect().height)), row: r.getBoundingClientRect().height, wide: l.getBoundingClientRect().right <= innerWidth }; })()`);
      assert.equal(seen.first, '“roof”', 'the words come first');
      assert.ok(seen.lit, 'and are lit: Enter takes them, nothing guessed');
      assert.equal(seen.count, '2 found', 'how many the words find');
      assert.ok(seen.kinds.includes('In') && seen.kinds.includes('Item'), `each item found offers In and Item, by kind: ${seen.kinds}`);
      assert.ok(seen.tall <= seen.row, `each choice one line at ${width} px (${seen.tall} against the bar's ${seen.row})`);
      assert.ok(seen.wide, `inside the page at ${width} px`);
      if (shots) writeFileSync(`${shots}/find-choices-${width}.png`, await page.screenshot());
      // Enter sets the words, every other term and the walk kept.
      await enter();
      assert.ok(await until(`location.hash.includes('text=roof') && ${has('Roof the shed')} && ${has('Site works')} && ${has('Gutters')}`), `Enter finds the words, the walk kept: ${await page.evaluate(`JSON.stringify(${drawn})`)} ${page.logs().join('\n')}`);
      assert.ok(await page.evaluate(has('Elsewhere')), 'the rest of the lens stays');
      assert.ok(await until(`document.querySelector('#find .q-sum')?.textContent.startsWith('Find“roof”or')`), 'the query bar says the words as a Find term, joined by or');
      assert.ok(await page.evaluate(`${list}.hidden && !document.getElementById('find').classList.contains('open')`), 'find shuts once it is drawn');
      if (shots) writeFileSync(`${shots}/find-drawn-${width}.png`, await page.screenshot());
      // Enter again puts new words in place of those the bar set, and nothing else.
      await type('walls');
      await enter();
      assert.ok(await until(`location.hash.includes('text=walls') && !location.hash.includes('text=roof') && ${has('Walls')} && ${has('Elsewhere')} && !${has('Roof the shed')}`), `Enter replaces only the words: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
      // Shift+Enter adds a set of words: both are found.
      await type('gutters');
      await enter(true);
      assert.ok(await until(`location.hash.includes('text=walls') && location.hash.includes('text=gutters') && ${has('Walls')} && ${has('Gutters')} && ${has('Elsewhere')}`), `Shift+Enter keeps both sets: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
      assert.ok(await until(`document.querySelector('#find .q-sum')?.textContent.includes('“walls”or“gutters”')`), 'each set its own Find term');
      // The words' × in find's rows takes them out, and back brings them again.
      await out('walls');
      await until(`!location.hash.includes('text=walls')`);
      await out('gutters');
      assert.ok(await until(`!location.hash.includes('text=') && !${has('Walls')} && ${has('Elsewhere')}`), `cleared, the words are out and the rest is drawn: ${await page.evaluate(`JSON.stringify(${drawn})`)} ${page.logs().join('\n')}`);
      // Each × was a step of its own: back twice brings both.
      await page.evaluate(`document.querySelector('#query [aria-label="Back"]').click()`);
      await until(`location.hash.includes('text=gutters')`);
      await page.evaluate(`document.querySelector('#query [aria-label="Back"]').click()`);
      assert.ok(await until(`location.hash.includes('text=walls') && location.hash.includes('text=gutters') && ${has('Walls')}`), `back draws the words again: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
      // Out again for the next width.
      await out('walls');
      await until(`!location.hash.includes('text=walls')`);
      await out('gutters');
      assert.ok(await until(`!location.hash.includes('text=') && ${has('Elsewhere')} && !${has('Walls')}`), 'cleared for the next width');
    }
    // A part's word and a space put find in that part: "only " is no words to find, and Only's choices are offered.
    await type('only ');
    assert.ok(await until(`document.querySelector('#find .find-mode')?.textContent === 'Only' && !document.querySelector('#find .find-mode').hidden && document.querySelector('#find input[type=search]').value === ''`), 'find is in Only, its mark before the box');
    await type('done');
    assert.ok(await until(`${list}.dataset.for === 'done' && ${list}.querySelector('.find-choice.lit')?.textContent === 'Worddone'`), `Only's own choices, the first lit: ${await page.evaluate(`${list}.textContent`)}`);
    await enter();
    assert.ok(await until(`location.hash.includes('only=done') && !document.getElementById('find').classList.contains('open')`), `Enter takes it as an Only term: ${await page.evaluate('location.hash')}`);
    // A kind's word leading what is typed offers that kind alone, found by the rest: "within site" is Within Site works.
    await type('only ');
    await type('within site');
    assert.ok(await until(`${list}.dataset.for === 'within site' && ${list}.querySelector('.find-choice.lit')?.textContent.startsWith('WithinSite works') && [...${list}.querySelectorAll('.find-choice .q-label')].every((k) => k.textContent === 'Within')`), `Within's choices alone: ${await page.evaluate(`${list}.textContent`)}`);
    await enter();
    assert.ok(await until(`location.hash.includes('within=${made.site}')`), `Enter takes it as within: ${await page.evaluate('location.hash')}`);
    // At rest find says, in its line, the lens an address carries.
    await page.go(`${base}/#/v?ids=${made.other}&text=gutters`);
    assert.ok(await until(`document.querySelector('#find .q-sum')?.textContent.includes('“gutters”')`), 'find says the lens up');
  } finally {
    page.close();
  }
});
