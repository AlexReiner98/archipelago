// The query's line in a real browser (skipped where there is no Chrome), at 1280 and at 560 px: one bar at the canvas's
// foot (decision e_2a4mddx8) says the lens in one line, what adds (Find) apart from what narrows (Only) and the walk,
// and what the lens's words found is lit, the rest it draws dimmed. The tab's controls are on the strip, never in the
// bar (e_j7ggggjr), and the bar acts on the pane last touched (e_x9b9yv5g).

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, the query line says the lens in one line at both widths', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'site', type: 'project', title: 'Site works' },
      { op: 'create', ref: 'roof', type: 'task', title: 'Roof the shed' },
      { op: 'create', ref: 'tiles', type: 'task', title: 'Roof tiles bought' },
      { op: 'create', ref: 'gutter', type: 'task', title: 'Gutters' },
      { op: 'create', ref: 'away', type: 'task', title: 'Roof elsewhere' },
      { op: 'link', type: 'part_of', from: 'roof', to: 'site' },
      { op: 'link', type: 'part_of', from: 'tiles', to: 'site' },
      { op: 'link', type: 'part_of', from: 'gutter', to: 'site' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?text=roof&within=${made.site}&over=part_of&steps=1`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(150)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const step = (n: number, id: string) => `[...document.querySelectorAll('#canvas > .pane')][${n}]?.querySelector('svg a[href="#/e/${id}"]')`;
  const drawn = (n: number, id: string) => `Boolean(${step(n, id)})`;
  const dim = (n: number, id: string) => `${step(n, id)}.classList.contains('dim')`;
  const parts = `[...document.querySelectorAll('#find-lens .q-sum-part > .q-label')].map((l) => l.textContent)`;
  const lineSays = `document.getElementById('find-lens').textContent`;
  const press = async (n: number) => {
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = [...document.querySelectorAll('#canvas > .pane')][${n}].querySelector('.pane-canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const find = (words: string) =>
    page.evaluate(`(() => { if (!document.getElementById('find').classList.contains('open')) document.getElementById('find-lens').click(); const i = document.querySelector('#find input[type=search]'); i.value = ${JSON.stringify(words)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); document.getElementById('find').requestSubmit(); })()`);
  const shots = process.env.PELAGO_SHOTS;
  try {
    assert.ok(await until(`${drawn(0, made.roof)} && ${drawn(0, made.tiles)} && ${drawn(0, made.site)}`), `the lens is drawn: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate(drawn(0, made.away))), 'what Only holds back is not drawn');
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await wait(300);
      // One bar, at the canvas's foot.
      const bar = await page.evaluate<{ bars: number; bottom: number; canvas: number }>(`(() => ({ bars: document.querySelectorAll('#find, .find-row').length, bottom: document.getElementById('find').getBoundingClientRect().bottom, canvas: document.getElementById('canvas').getBoundingClientRect().bottom }))()`);
      assert.equal(bar.bars, 2, 'one find, with one row');
      assert.ok(bar.canvas - bar.bottom < 80, `find stands at the canvas's foot at ${width} px (${bar.bottom} of ${bar.canvas})`);
      // The line: one line, Find apart from Only and the walk.
      assert.ok(await until(`${parts}.join('|') === 'Find|Only|Walk'`), `Find, Only and Walk each a part of the line: ${await page.evaluate(`JSON.stringify(${parts})`)}`);
      const said = await page.evaluate<string>(lineSays);
      assert.ok(said.includes('“roof”') && said.includes('within Site works'), `the words are Find's, within is Only's: ${said}`);
      const tall = await page.evaluate<{ scroll: number; client: number; line: number }>(`(() => { const l = document.getElementById('find-lens'); const s = l.querySelector('.q-sum'); return { scroll: l.scrollHeight, client: l.clientHeight, line: Math.max(...[...s.querySelectorAll('.q-sum-part')].map((p) => p.getBoundingClientRect().height)) }; })()`);
      assert.ok(tall.scroll <= tall.client + 1, `one line at ${width} px (${tall.scroll} against ${tall.client})`);
      assert.ok(tall.line <= tall.client + 1, `no part of it wraps at ${width} px (${tall.line} against ${tall.client})`);
      // What the words found is lit; what the walk reached, dimmed.
      assert.ok(await until(`!${dim(0, made.roof)} && !${dim(0, made.tiles)} && ${dim(0, made.site)}`), `the words' hits lit, the rest dimmed at ${width} px`);
      // The tab's controls are on the strip, none in the bar.
      assert.ok(await page.evaluate<boolean>(`Boolean(document.querySelector('#tabs .tab [aria-label^="This tab"]') && document.querySelector('#tabs .tab-new'))`), 'the tab’s menu and + are on the strip');
      assert.ok(!(await page.evaluate<boolean>(`Boolean(document.querySelector('#query .tab-act, #query .tab-new, #find .tab-act, #find .tab-new'))`)), 'and not in the bar');
      if (shots) writeFileSync(`${shots}/query-line-${width}.png`, await page.screenshot());
    }
    await page.send('Emulation.clearDeviceMetricsOverride');
    // Split, then find in the second: the bar is the second's. A press in the first gives the bar back to it.
    await page.evaluate(`document.querySelector('#query [aria-label="Split"]').click()`);
    assert.ok(await until(`document.querySelectorAll('#canvas > .pane').length === 2 && ${drawn(1, made.roof)}`), 'Split opens a second pane of the same lens');
    await press(1);
    assert.ok(await until(`[...document.querySelectorAll('#canvas > .pane')][1].classList.contains('pane-active')`), 'the second is the one touched');
    await find('gutters');
    assert.ok(await until(`${lineSays}.includes('“gutters”') && ${drawn(1, made.gutter)} && !${dim(1, made.gutter)}`), `find set the second's words: ${await page.evaluate(lineSays)}`);
    const inside = (n: number) => `(() => { const f = document.getElementById('find').getBoundingClientRect(); const p = [...document.querySelectorAll('#canvas > .pane')][${n}].getBoundingClientRect(); const mid = (f.left + f.right) / 2; return mid > p.left && mid < p.right; })()`;
    assert.ok(await page.evaluate(inside(1)), 'find stands under the pane it acts on');
    await press(0);
    assert.ok(await until(`${lineSays}.includes('“roof”') && !${lineSays}.includes('gutters')`), `the first's lens again: ${await page.evaluate(lineSays)}`);
    assert.ok(await page.evaluate(inside(0)), 'and find under it');
  } finally {
    page.close();
  }
});
