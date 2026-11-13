// The narrowing terms in the query bar, in a real browser (skipped where there is no Chrome): an address that narrows
// (only a type, within an item) draws only what holds, and find (the query's line and rows) shows each in its Only row, apart from what Find
// finds (decision e_drt4g872). Find's box takes `only <type>` and `within <id>`; a term's × takes the narrowing out. At
// 1280 and at 560 px, the bar stays one line. The line and the rows are the bar pack's parts (bar.query, bar.rows).

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
      { op: 'create', ref: 'site', type: 'aim', title: 'Site works' },
      { op: 'create', ref: 'roof', type: 'work', title: 'Roof' },
      { op: 'create', ref: 'which', type: 'question', title: 'Which tiles?' },
      { op: 'create', ref: 'gutter', type: 'task', title: 'Gutters' },
      { op: 'create', ref: 'away', type: 'question', title: 'Elsewhere?' },
      { op: 'link', type: 'part_of', from: 'roof', to: 'site' },
      { op: 'link', type: 'part_of', from: 'which', to: 'roof' },
      { op: 'link', type: 'part_of', from: 'gutter', to: 'roof' },
    ],
  })).result.created as Record<string, string>;
  // Drawn as a flow, whatever the house style says: what is drawn is read off its marks.
  const page = await open(`${base}/#/v?find=type+question&only=in+${made.site}&shape=flow`);
  const drawn = `[...document.querySelectorAll('#canvas svg a')].map((a) => a.textContent)`;
  const has = (title: string) => `${drawn}.some((t) => t.includes(${JSON.stringify(title)}))`;
  // A row of the rows by its word, and the boxes of its terms (those the host hides past what fits among them).
  const row = (word: string) => `[...document.querySelectorAll('#find-rows .pm-box')].find((b) => b.firstElementChild?.textContent === ${JSON.stringify(word)})`;
  const terms = (word: string) => `[...(${row(word)}?.querySelector(':scope > .pm-fits')?.children ?? [])].filter((c) => !c.classList.contains('pm-fits-rest'))`;
  const chips = `${terms('Only')}.map((c) => c.firstElementChild.textContent)`;
  // Picked in a row's menu, opened from its +: a kind (a pick, so the menu stays open), then the thing (decision
  // e_45sgrfqd); nothing is written to be guessed. Each step waits for the part to draw it.
  const pick = (word: string, ...path: string[]) => page.evaluate(`(async () => {
    const menu = () => ${row(word)}.querySelector(':scope > details.pm-menu');
    menu().open = true;
    for (const label of ${JSON.stringify(path)}) {
      for (let tries = 0; tries < 60; tries++) {
        const m = menu();
        const sel = [...m.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent === label));
        const option = sel && [...sel.options].find((o) => o.textContent === label);
        if (option && sel.value !== option.value) { sel.value = option.value; sel.dispatchEvent(new Event('change', { bubbles: true })); break; }
        const button = [...m.querySelectorAll('button')].find((b) => b.textContent === label);
        if (button) { button.click(); break; }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  })()`);
  const shots = process.env.PELAGO_SHOTS;
  try {
    assert.ok(await page.until(has('Which tiles?')), `the narrowed canvas is drawn: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate(has('Elsewhere?'))), 'a question outside the project is not');
    assert.ok(await page.until(`${chips}.join('|') === 'in Site works'`), `within is in the Only row, by the item's name: ${await page.evaluate(`JSON.stringify(${chips})`)} ${page.logs().join('\n')}`);
    assert.deepEqual(await page.evaluate(`${terms('Find')}.map((c) => c.firstElementChild.textContent)`), ['Question'], 'what Find finds stays apart');
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      // The query is one row under the view's: nothing in it wraps onto a second line.
      const tall = await page.evaluate<{ bar: number; part: number }>(`(() => { const row = document.querySelector('#find .q-lens'); return { bar: row.scrollHeight, part: row.clientHeight }; })()`);
      assert.ok(tall.bar <= tall.part + 1, `one line at ${width} px (${tall.bar} against ${tall.part})`);
      if (shots) writeFileSync(`${shots}/narrow-bar-${width}.png`, await page.screenshot());
    }
    await page.send('Emulation.clearDeviceMetricsOverride');
    // Pointing at a term of Find lights what it found: the rest of the picture fades, whatever drew it.
    const faded = (title: string) => `Number(getComputedStyle([...document.querySelectorAll('#canvas [data-item]')].find((a) => a.textContent.includes(${JSON.stringify(title)}))).opacity) < 1`;
    await page.evaluate(`document.getElementById('find-lens')?.click()`);
    await pick('Find', 'Type', 'Task');
    assert.ok(await page.until(`${has('Gutters')} && ${has('Which tiles?')}`), 'two types found');
    assert.ok(await page.until(`${terms('Find')}.length === 2 && ${terms('Find')}[0].matches('.pm-lights')`), 'each term of Find says what it lights');
    const point = await page.evaluate<{ x: number; y: number }>(`(() => { const r = ${terms('Find')}.find((c) => c.textContent.startsWith('Question')).firstElementChild.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    assert.ok(await page.until(faded('Gutters')), `the type not pointed at fades: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate(faded('Which tiles?'))), 'what the term found stays lit');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    assert.ok(await page.until(`!(${faded('Gutters')})`), 'moved off, nothing is faded');
    await page.evaluate(`${terms('Find')}.find((c) => c.textContent.startsWith('Task')).querySelector('button').click()`);
    assert.ok(await page.until(`!${has('Gutters')}`), 'the second type taken out');
    // The page's tip alone speaks: on a term, and after a click on it, no title is left from there up for the browser to show.
    const titles = `(() => { const titled = []; for (let e = ${terms('Only')}[0]?.firstElementChild; e; e = e.parentElement) if (e.hasAttribute('title')) titled.push(e.className); return titled; })()`;
    await page.evaluate(`document.getElementById('find-lens')?.click()`);
    const spot = await page.evaluate<{ x: number; y: number }>(`(() => { const r = ${terms('Only')}[0].firstElementChild.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...spot });
    assert.ok(await page.until(`document.querySelector('.tip')?.matches(':popover-open')`), 'the page says it in its own tip');
    assert.ok(await page.until(`${titles}.length === 0`), `on a term, no title is left above it: ${JSON.stringify(await page.evaluate(titles))}`);
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...spot, button: 'left', clickCount: 1 });
    assert.ok(await page.until(`${titles}.length === 0`), `nor after a click on it: ${JSON.stringify(await page.evaluate(titles))}`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    assert.ok(await page.until(`${terms('Only')}[0].hasAttribute('title')`), 'moved away, each title is back');
    // The box narrows: more types found, then only one of them.
    await pick('Find', 'Type', 'Task');
    assert.ok(await page.until(`${has('Gutters')} && ${has('Which tiles?')}`), `a type more is found within it: ${page.logs().join('\n')}`);
    await pick('Only', 'Type', 'Task');
    assert.ok(await page.until(`location.hash.includes('only=type+task') && ${has('Gutters')} && !${has('Which tiles?')}`), `only narrows what is found: ${await page.evaluate(`JSON.stringify(${drawn})`)}`);
    assert.ok(await page.until(`${chips}.join('|') === 'Task|in Site works'`), `each narrowing a term of Only: ${await page.evaluate(`JSON.stringify(${chips})`)}`);
    // Its × takes it out, and what it held back is drawn again.
    await page.evaluate(`${terms('Only')}.find((c) => !c.textContent.includes('in Site')).querySelector('button').click()`);
    assert.ok(await page.until(`location.hash.split('only=').length === 2 && ${has('Which tiles?')}`), 'taken out, it narrows no more');
    await page.evaluate(`${terms('Only')}.find((c) => c.textContent.includes('in Site')).querySelector('button').click()`);
    assert.ok(await page.until(`!location.hash.includes('only=') && ${has('Elsewhere?')}`), 'nor within');
  } finally {
    await page.close();
  }
});
