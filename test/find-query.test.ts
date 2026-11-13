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
import * as F from './find-dom.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, the find bar sets the text of the canvas lens', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'site', type: 'aim', title: 'Site works' },
      { op: 'create', ref: 'roof', type: 'task', title: 'Roof the shed' },
      { op: 'create', ref: 'walls', type: 'task', title: 'Walls', body: 'Up before the roof goes on.' },
      { op: 'create', ref: 'gutter', type: 'task', title: 'Gutters' },
      { op: 'create', ref: 'other', type: 'task', title: 'Elsewhere', status: 'done' },
      { op: 'create', ref: 'next', type: 'task', title: 'The next job' },
      { op: 'link', type: 'depends_on', from: 'other', to: 'next' },
      { op: 'link', type: 'part_of', from: 'next', to: 'site' },
      { op: 'link', type: 'part_of', from: 'roof', to: 'site' },
      { op: 'link', type: 'part_of', from: 'walls', to: 'site' },
      { op: 'link', type: 'depends_on', from: 'gutter', to: 'roof' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?find=id+${made.other}&over=part_of,depends_on&steps=1&shape=flow`);
  const drawn = `[...document.querySelectorAll('#canvas svg a')].map((a) => a.textContent)`;
  const has = (title: string) => `${drawn}.some((t) => t.includes(${JSON.stringify(title)}))`;
  // Typed as a person does in find's field (the find pack's part: test/find-dom.ts).
  const type = (q: string) => page.evaluate(F.type(q));
  // Enter, or with Shift held to add what the words find.
  const enter = (shift = false) => page.evaluate(F.key('Enter', shift));
  // A set of words taken out by its × in find's Find row.
  // In the bar's rows (its part, slot bar.find.rows): each term a box of its words and its ×.
  const out = (w: string) => page.evaluate(`[...document.querySelectorAll('#find-rows .pm-box')].find((b) => b.querySelector(':scope > .pm-text')?.textContent === '“${w}”')?.querySelector(':scope > .pm-button')?.click()`);
  const list = F.list;
  // The lens in one line at rest: the bar's part (slot bar.find), in #find-lens.
  const line = `(document.getElementById('find-lens')?.textContent ?? '')`;
  const shots = process.env.PELAGO_SHOTS;
  try {
    assert.ok(await page.until(has('Elsewhere')), `the canvas is drawn: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate(has('Roof the shed'))), 'what is not found is not drawn yet');
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await type('roof');
      assert.ok(await page.until(`${F.shown} && ${list}.textContent.includes('Roof the shed') && ${list}.textContent.includes('found')`), `typing lists what the words could be: ${page.logs().join('\n')}`);
      const seen = await page.evaluate<{ first: string; lit: boolean; count: string; kinds: string[]; tall: number; row: number; wide: boolean }>(`(() => { const l = ${list}; const c = ${F.choices}; const s = ${F.saidAll}; const r = document.querySelector('#find .find-row'); return { first: s[0].name, lit: s[0].lit, count: s[0].notes[0] ?? '', kinds: s.map((x) => x.kind), tall: Math.max(...c.map((x) => x.getBoundingClientRect().height)), row: r.getBoundingClientRect().height, wide: l.getBoundingClientRect().right <= innerWidth }; })()`);
      assert.equal(seen.first, '“roof”', 'the words come first');
      assert.ok(seen.lit, 'and are lit: Enter takes them, nothing guessed');
      assert.equal(seen.count, '2 found', 'how many the words find');
      assert.ok(await page.until(`${F.saidAll}.some((c) => c.notes.some((n) => n.startsWith('+')))`), `each choice says how many it would add: ${await page.evaluate(`${list}.textContent`)}`);
      assert.ok(seen.kinds.includes('In') && seen.kinds.includes('Item'), `each item found offers In and Item, by kind: ${seen.kinds}`);
      assert.ok(seen.tall <= seen.row, `each choice one line at ${width} px (${seen.tall} against the bar's ${seen.row})`);
      assert.ok(seen.wide, `inside the page at ${width} px`);
      if (shots) writeFileSync(`${shots}/find-choices-${width}.png`, await page.screenshot());
      // Enter sets the words, every other term and the walk kept.
      await enter();
      assert.ok(await page.until(`location.hash.includes('find=text+roof') && ${has('Roof the shed')} && ${has('Site works')} && ${has('Gutters')}`), `Enter finds the words, the walk kept: ${await page.evaluate(`JSON.stringify(${drawn})`)} ${page.logs().join('\n')}`);
      assert.ok(await page.evaluate(has('Elsewhere')), 'the rest of the lens stays');
      assert.ok(await page.until(`/Find.*“roof”/.test(${line})`), 'the query bar says the words as a Find term, joined by or');
      assert.ok(await page.until(`!(${F.shown}) && ${F.isOpen} && document.activeElement === ${F.input} && !${F.input}.value`), `find stays open and emptied, the cursor in it, to refine further: ${await page.evaluate(`JSON.stringify([${F.shown}, ${F.isOpen}, document.activeElement?.outerHTML.slice(0, 80)])`)}`);
      if (shots) writeFileSync(`${shots}/find-drawn-${width}.png`, await page.screenshot());
      // Enter again puts new words in place of those the bar set, and nothing else.
      await type('walls');
      await enter();
      assert.ok(await page.until(`location.hash.includes('find=text+walls') && !location.hash.includes('find=text+roof') && ${has('Walls')} && ${has('Elsewhere')} && !${has('Roof the shed')}`), `Enter replaces only the words: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
      // Shift+Enter adds a set of words: both are found.
      await type('gutters');
      await enter(true);
      assert.ok(await page.until(`location.hash.includes('find=text+walls') && location.hash.includes('find=text+gutters') && ${has('Walls')} && ${has('Gutters')} && ${has('Elsewhere')}`), `Shift+Enter keeps both sets: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
      assert.ok(await page.until(`${line}.includes('“walls”') && ${line}.includes('“gutters”')`), 'each set its own Find term');
      // The words' × in find's rows takes them out, and back brings them again.
      await out('walls');
      await page.until(`!location.hash.includes('find=text+walls')`);
      await out('gutters');
      assert.ok(await page.until(`!location.hash.includes('find=text+') && !${has('Walls')} && ${has('Elsewhere')}`), `cleared, the words are out and the rest is drawn: ${await page.evaluate(`JSON.stringify(${drawn})`)} ${page.logs().join('\n')}`);
      // Each × was a step of its own: back twice brings both.
      await page.evaluate(`document.querySelector('#query [aria-label="Back"]').click()`);
      await page.until(`location.hash.includes('find=text+gutters')`);
      await page.evaluate(`document.querySelector('#query [aria-label="Back"]').click()`);
      assert.ok(await page.until(`location.hash.includes('find=text+walls') && location.hash.includes('find=text+gutters') && ${has('Walls')}`), `back draws the words again: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
      // Out again for the next width.
      await out('walls');
      await page.until(`!location.hash.includes('find=text+walls')`);
      await out('gutters');
      assert.ok(await page.until(`!location.hash.includes('find=text+') && ${has('Elsewhere')} && !${has('Walls')}`), 'cleared for the next width');
    }
    // A part's word and a space put find in that part: "only " is no words to find, and Only's choices are offered.
    await type('only ');
    assert.ok(await page.until(`${F.mode} === 'Only' && ${F.input}.value === ''`), 'find is in Only, its mark before the box');
    await type('done');
    // Drawn for "done", not still for what was typed before: Status done is offered only for it.
    assert.ok(await page.until(`((s) => s.some((c) => c.kind === 'Status' && c.name === 'done') && s.find((c) => c.lit)?.kind === 'Word' && s.find((c) => c.lit)?.name === 'done')(${F.saidAll})`), `Only's own choices, the first lit: ${await page.evaluate(`${list}?.textContent`)}`);
    await enter();
    assert.ok(await page.until(`location.hash.includes('only=done') && ${F.mode} === 'Find'`), `Enter takes it as an Only term: ${await page.evaluate('location.hash')}`);
    // A kind's word leading what is typed offers that kind alone, found by the rest: "in site" is In Site works.
    await type('only ');
    await type('in site');
    assert.ok(await page.until(`((s) => s.length > 0 && s[0].lit && s[0].name === 'Site works' && s.every((c) => c.kind === 'In'))(${F.saidAll})`), `In's choices alone: ${await page.evaluate(`${list}?.textContent`)}`);
    await enter();
    assert.ok(await page.until(`location.hash.includes('only=in+${made.site}')`), `Enter takes it as within: ${await page.evaluate('location.hash')}`);
    // At rest find says, in its line, the lens an address carries.
    await page.go(`${base}/#/v?find=id+${made.other}&find=text+gutters`);
    assert.ok(await page.until(`${line}.includes('“gutters”')`), 'find says the lens up');
  } finally {
    await page.close();
  }
});
