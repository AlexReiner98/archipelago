// The query's line in a real browser (skipped where there is no Chrome), at 1280 and at 560 px: one bar at the canvas's
// foot (decision e_2a4mddx8) says the lens in one line, what adds (Find) apart from what narrows (Only) and the walk,
// and what the lens's words found is lit, the rest it draws dimmed. The line is the bar pack's part bar.query, its rows bar.rows. The tab's controls are on the strip, never in the
// bar (e_j7ggggjr), and the bar acts on the pane last touched (e_x9b9yv5g).

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import * as F from './find-dom.ts';
import { PANE } from './tab-page.ts';

const browser = chrome();

test('in a browser, the query line says the lens in one line at both widths', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'site', type: 'task', title: 'Site works' },
      { op: 'create', ref: 'roof', type: 'task', title: 'Roof the shed' },
      { op: 'create', ref: 'tiles', type: 'task', title: 'Roof tiles bought' },
      { op: 'create', ref: 'gutter', type: 'task', title: 'Gutters' },
      { op: 'create', ref: 'away', type: 'task', title: 'Roof elsewhere' },
      { op: 'link', type: 'part_of', from: 'roof', to: 'site' },
      { op: 'link', type: 'part_of', from: 'tiles', to: 'site' },
      { op: 'link', type: 'part_of', from: 'gutter', to: 'site' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?find=text+roof&only=in+${made.site}&over=part_of&steps=1`);
  const step = (n: number, id: string) => `[...document.querySelectorAll('${PANE}')][${n}]?.querySelector('svg a[href="#/e/${id}"]')`;
  const drawn = (n: number, id: string) => `Boolean(${step(n, id)})`;
  const dim = (n: number, id: string) => `${step(n, id)}.classList.contains('dim')`;
  const parts = `[...document.querySelectorAll('#find-lens .pm-fits > .pm-bold')].map((l) => l.textContent)`;
  const lineSays = `document.getElementById('find-lens').textContent`;
  const press = async (n: number) => {
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = [...document.querySelectorAll('${PANE}')][${n}].querySelector('.pane-canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  // Typed in find as a person does (the find pack's part: test/find-dom.ts), then Enter.
  const find = async (words: string) => (await page.evaluate(F.type(words)), await page.evaluate(F.key('Enter')));
  const shots = process.env.PELAGO_SHOTS;
  try {
    assert.ok(await page.until(`${drawn(0, made.roof)} && ${drawn(0, made.tiles)} && ${drawn(0, made.site)}`), `the lens is drawn: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate(drawn(0, made.away))), 'what Only holds back is not drawn');
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      assert.ok(await page.still(`[document.getElementById('find')?.getBoundingClientRect(), document.getElementById('canvas')?.getBoundingClientRect()]`), 'laid out at the width');
      // One bar, at the canvas's foot.
      const bar = await page.evaluate<{ bars: number; bottom: number; canvas: number }>(`(() => ({ bars: document.querySelectorAll('#find, .find-row').length, bottom: document.getElementById('find').getBoundingClientRect().bottom, canvas: document.getElementById('canvas').getBoundingClientRect().bottom }))()`);
      assert.equal(bar.bars, 2, 'one find, with one row');
      assert.ok(bar.canvas - bar.bottom < 80, `find stands at the canvas's foot at ${width} px (${bar.bottom} of ${bar.canvas})`);
      // The line: one line, Find apart from Only and the walk.
      assert.ok(await page.until(`${parts}.join('|') === 'Find|Only|Walk'`), `Find, Only and Walk each a part of the line: ${await page.evaluate(`JSON.stringify(${parts})`)}`);
      const said = await page.evaluate<string>(lineSays);
      assert.ok(said.includes('“roof”') && said.includes('in Site works'), `the words are Find's, within is Only's: ${said}`);
      const tall = await page.evaluate<{ scroll: number; client: number; line: number }>(`(() => { const l = document.getElementById('find-lens'); return { scroll: l.scrollHeight, client: l.clientHeight, line: Math.max(...[...l.querySelectorAll('.pm-fits > :not([hidden])')].map((p) => p.getBoundingClientRect().height)) }; })()`);
      assert.ok(tall.scroll <= tall.client + 1, `one line at ${width} px (${tall.scroll} against ${tall.client})`);
      assert.ok(tall.line <= tall.client + 1, `no part of it wraps at ${width} px (${tall.line} against ${tall.client})`);
      // What the words found is lit; what the walk reached, dimmed.
      assert.ok(await page.until(`!${dim(0, made.roof)} && !${dim(0, made.tiles)} && ${dim(0, made.site)}`), `the words' hits lit, the rest dimmed at ${width} px`);
      // The tab's controls are on the strip, none in the bar.
      assert.ok(await page.evaluate<boolean>(`Boolean(document.querySelector('#tabs [data-key^="tab:"] details.pm-menu') && document.querySelector('#tabs [data-key="new"]'))`), 'the tab’s menu and + are on the strip');
      assert.ok(!(await page.evaluate<boolean>(`Boolean(document.querySelector('#query [data-key^="menu:"], #query [data-key="new"], #find [data-key^="menu:"], #find [data-key="new"]'))`)), 'and not in the bar');
      if (shots) writeFileSync(`${shots}/query-line-${width}.png`, await page.screenshot());
    }
    await page.send('Emulation.clearDeviceMetricsOverride');
    // Split, then find in the second: the bar is the second's. A press in the first gives the bar back to it.
    await page.evaluate(`document.querySelector('#query [aria-label="Split"]').click()`);
    assert.ok(await page.until(`document.querySelectorAll('${PANE}').length === 2 && !${drawn(1, made.roof)}`), 'Split opens a blank pane, with no query');
    await press(1);
    assert.ok(await page.until(`[...document.querySelectorAll('${PANE}')][1].getAttribute('aria-selected') === 'true'`), 'the second is the one touched');
    await find('gutters');
    assert.ok(await page.until(`${lineSays}.includes('“gutters”') && ${drawn(1, made.gutter)} && !${dim(1, made.gutter)}`), `find set the second's words: ${await page.evaluate(lineSays)}`);
    const inside = (n: number) => `(() => { const f = document.getElementById('find').getBoundingClientRect(); const p = [...document.querySelectorAll('${PANE}')][${n}].getBoundingClientRect(); const mid = (f.left + f.right) / 2; return mid > p.left && mid < p.right; })()`;
    assert.ok(await page.evaluate(inside(1)), 'find stands under the pane it acts on');
    await press(0);
    assert.ok(await page.until(`${lineSays}.includes('“roof”') && !${lineSays}.includes('gutters')`), `the first's lens again: ${await page.evaluate(lineSays)}`);
    assert.ok(await page.evaluate(inside(0)), 'and find under it');
  } finally {
    await page.close();
  }
});

test('in a browser, a lens of many long terms stays in the line, and each term can still be taken out', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const names = Array.from({ length: 9 }, (_, i) => `Term ${i} with a title long enough to take the whole line`);
  const made = (await call('/api/change', undefined, { reason: 'test', ops: names.map((title, i) => ({ op: 'create', ref: `t${i}`, type: 'task', title })) })).result.created as Record<string, string>;
  const finds = names.slice(0, 6).map((_, i) => `find=id+${made[`t${i}`]}`).join('&');
  const nots = names.slice(6).map((_, i) => `not=id+${made[`t${i + 6}`]}`).join('&');
  const page = await open(`${base}/#/v?${finds}&${nots}&not=done&only=type+task&over=depends_on&steps=0&limit=60`);
  const lineSays = `document.getElementById('find-lens').textContent`;
  const labels = `[...document.querySelectorAll('#find-lens .pm-fits > .pm-bold')].map((l) => l.textContent).join('|')`;
  // Nothing of the line past the bar's edges, either way, and every part one line high.
  const staysIn = async (where: string) => {
    const box = await page.evaluate<{ out: string[]; cut: boolean; more: number }>(`(() => {
      const b = document.getElementById('find').getBoundingClientRect();
      const l = document.getElementById('find-lens');
      const out = [...l.querySelectorAll('.part-body *')].filter((e) => !e.closest('[hidden]')).map((e) => [e, e.getBoundingClientRect()]).filter(([e, r]) => r.width > 0 && (r.top < b.top || r.bottom > b.bottom || r.left < b.left || r.right > b.right)).map(([e]) => e.className);
      return { out, cut: l.scrollHeight > l.clientHeight + 1, more: l.querySelectorAll('.pm-fits-rest:not([hidden])').length };
    })()`);
    assert.deepEqual(box.out, [], `nothing leaves the bar ${where}`);
    assert.ok(!box.cut, `the line is one line ${where}`);
    assert.ok(box.more >= 1, `a part says how many more it holds ${where}`);
  };
  try {
    assert.ok(await page.until(`${lineSays}.includes('Term 0') && !${lineSays}.includes('…')`), `the terms are named: ${page.logs().join('\n')}`);
    // A walk of no steps reaches nothing: the line says nothing of it.
    assert.equal(await page.evaluate<string>(labels), 'Find|Only|Not', 'no Walk on the line');
    assert.ok(!(await page.evaluate<string>(lineSays)).includes('×0'), 'nor ×0');
    assert.ok(await page.evaluate<boolean>(`Boolean([...document.querySelectorAll('#find-rows .pm-box')].find((b) => b.firstElementChild?.textContent === 'Walk')?.textContent.includes('depends on'))`), 'its link is still in the row, to take out');
    await page.evaluate(`location.hash = location.hash.replace('steps=0', 'steps=2')`);
    assert.ok(await page.until(`${labels} === 'Find|Only|Not|Walk'`), 'with steps it is on the line');
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      assert.ok(await page.still(`[document.getElementById('find')?.getBoundingClientRect(), document.getElementById('canvas')?.getBoundingClientRect()]`), 'laid out at the width');
      await staysIn(`at ${width} px`);
      assert.ok(await page.evaluate<boolean>(`[...document.querySelectorAll('#find-lens .pm-text')].some((e) => e.textContent === '×2' && e.getBoundingClientRect().width > 0)`), `the walk's steps are in sight at ${width} px`);
      // Each term says itself whole in its tip, those past what fits too.
      const title = await page.evaluate<string>(`[...document.querySelectorAll('#find-lens [title]')].map((e) => e.title).join(' · ')`);
      for (const name of names) assert.ok(title.includes(name), `the tooltip has the whole: ${name}`);
    }
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.evaluate(`document.querySelector('#query [aria-label="Split"]').click()`);
    assert.ok(await page.until(`document.querySelectorAll('${PANE}').length === 2`), 'split');
    assert.ok(await page.still(`[document.getElementById('find')?.getBoundingClientRect(), document.getElementById('canvas')?.getBoundingClientRect()]`), 'laid out split');
    await staysIn('in a split pane');
    // A click opens the rows; a row's count of what did not fit, pressed, shows every term with its ×.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 560, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))`);
    assert.ok(await page.until(F.isOpen), 'find opens');
    const findRow = `[...document.querySelectorAll('#find-rows .pm-box')].find((b) => b.firstElementChild?.textContent === 'Find')`;
    assert.ok(await page.until(`Boolean(${findRow}?.querySelector('.pm-fits-rest:not([hidden])'))`), 'the Find row holds more than fit');
    await page.evaluate(`${findRow}.querySelector('.pm-fits-rest').click()`);
    assert.ok(await page.until(`${findRow}.querySelectorAll('button[title="Take it out"]').length === 6 && [...${findRow}.querySelectorAll('button[title="Take it out"]')].every((b) => b.getBoundingClientRect().width > 0)`), 'it shows them all, each with its ×');
    await page.evaluate(`${findRow}.querySelector('button[title="Take it out"]').click()`);
    assert.ok(await page.until(`location.hash.split('find=').length === 6`), `one term is taken out: ${await page.evaluate('location.hash')}`);
  } finally {
    await page.close();
  }
});
