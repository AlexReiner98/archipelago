// How a reader hears of an agent's show (ui/live.js, ui/pane-land.js): no line at the foot, a note on the pane, a page
// that is no canvas in a tab of its own, a show held while a question is open; and a pane moved into a tab by hand
// (ui/tab-bar.js, decision e_c5stzz6z). In a file of its own: the steps a server keeps outlive a test in one process, so
// a session here would be heard by a page in another test, and could share its name.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a show lands without a line at the foot: a note on its pane, a screen in a tab, a question waited for, a pane moved to a tab', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'work', title: 'Something shown' }] })).result.created as Record<string, string>;
  const agent = 'agent:claude-code/archipelago';
  const { run, name } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'no-line' } })).result;
  const page = await open(`${base}/`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: string, ok: () => Promise<boolean>) => {
    for (let n = 0; n < 60; n++) if (await ok()) return;
    else await wait(250);
    assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const show = (params: Record<string, unknown>) => call('/agent/report', undefined, { actor: agent, action: 'show', params: { ...params, run } });
  const tabs = () => page.evaluate<number>(`document.querySelectorAll('#tabs .tab').length`);
  try {
    await wait(3000);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('#followed, #follow'))`), false, 'no line, and nothing in the menu to turn it on');
    // The note is on the pane, in its mark's tooltip.
    await show({ entity: made.a, note: 'What the note says' });
    await until('its pane', () => page.evaluate<boolean>(`document.querySelectorAll('#canvas > .pane').length === 2`));
    assert.deepEqual(JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const m = [...document.querySelectorAll('#canvas > .pane')][1].querySelector('.pane-follows'); return [m.textContent, m.title]; })())`)), [`Session ${name}`, 'What the note says']);
    // A page that is no canvas takes no pane of the reader's: a tab of its own, marked, and it is open there.
    await show({ screen: 'workspace' });
    await until('a tab of its own', async () => (await tabs()) === 2);
    assert.equal(await page.evaluate(`document.querySelectorAll('#canvas > .pane').length`), 2, 'the tab in sight stays as it was');
    assert.equal(await page.evaluate(`document.querySelector('#tabs .tab:nth-child(2)').dataset.unseen`), 'true');
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector('#tabs .tab:nth-child(2) .tab-name').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await until('the workspace is open in it', () => page.evaluate<boolean>(`location.hash.startsWith('#/workspace')`));
    // A question open over the page holds a show: it lands once the question is answered.
    await page.evaluate(`(() => { const d = document.createElement('dialog'); d.id = 'held'; document.body.append(d); d.showModal(); })()`);
    await show({ entity: made.a, pane: 'after' });
    await wait(3000);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.pane-follows')?.textContent === 'after')`), false, 'nothing lands while it is open');
    await page.evaluate(`document.getElementById('held').close()`);
    await until('it lands', () => page.evaluate<boolean>(`[...document.querySelectorAll('.pane-follows')].some((m) => m.textContent === 'after')`));
    // ⧉ moves a pane into a tab of its own, in sight beside the one it left; the session it was held for goes with it.
    const [x1, y1] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector('#tabs .tab:nth-child(1) .tab-name').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: x1, y: y1, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await until('the first tab in sight, its two panes drawn', () => page.evaluate<boolean>(`document.querySelectorAll('#canvas > .pane').length === 2 && document.querySelector('#tabs .tab:nth-child(1)').getAttribute('aria-selected') === 'true'`));
    await page.evaluate(`[...document.querySelectorAll('#canvas > .pane')][1].querySelector('[aria-label="Move this pane to a new tab"]').click()`);
    await until('a tab of its own, in sight', async () => (await tabs()) === 3 && (await page.evaluate<boolean>(`document.querySelectorAll('#canvas > .pane').length === 1 && document.querySelector('#tabs .tab:nth-child(2)').getAttribute('aria-selected') === 'true'`)));
    assert.equal(await page.evaluate(`document.querySelector('#tabs .tab:nth-child(2) .tab-name').textContent`), `Session ${name}`);
    assert.equal(await page.evaluate(`document.querySelector('#tabs .tab:nth-child(2)').title.includes('follows its session')`), true);
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[aria-label="Move this pane to a new tab"]')).display`), 'none', 'a pane alone has nothing to leave');
    // The way back: Merge into in ⋯ puts it beside the first tab's panes, in sight, and it is the session's pane again.
    const panes = () => page.evaluate<number>(`document.querySelectorAll('#canvas > .pane').length`);
    await page.evaluate(`document.querySelector('#tabs .tab:nth-child(2) [aria-label="This tab: whom it follows, pop it out"]').click()`);
    await page.evaluate(`document.querySelectorAll('.tab-menu [role="menuitem"]')[1].click()`);
    await until('merged back', async () => (await tabs()) === 2 && (await panes()) === 2 && (await page.evaluate<boolean>(`document.querySelector('#tabs .tab:nth-child(1)').getAttribute('aria-selected') === 'true'`)));
    assert.equal(await page.evaluate(`[...document.querySelectorAll('#canvas > .pane')][1].querySelector('.pane-follows').textContent`), `Session ${name}`);
    const middle = (selector: string) => page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`).then(JSON.parse) as Promise<[number, number]>;
    const drag = async (from: [number, number], to: [number, number]) => {
      const mouse = (type: string, at: number[]) => page.send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
      await mouse('mousePressed', from);
      for (let n = 1; n <= 8; n++) await mouse('mouseMoved', [from[0] + ((to[0] - from[0]) * n) / 8, from[1] + ((to[1] - from[1]) * n) / 8]);
      await mouse('mouseReleased', to);
    };
    // A pane dragged onto another tab joins it, and that tab comes into sight.
    await drag(await middle('#canvas > .pane:nth-of-type(2) .pane-grip'), await middle('#tabs .tab:nth-child(2) .tab-name'));
    await until('the pane joined the second tab', async () => (await panes()) === 3 && (await page.evaluate<boolean>(`document.querySelector('#tabs .tab:nth-child(2)').getAttribute('aria-selected') === 'true'`)));
    // A tab dragged onto another merges into it, and is gone.
    await drag(await middle('#tabs .tab:nth-child(2) .tab-name'), await middle('#tabs .tab:nth-child(1) .tab-name'));
    await until('one tab holds every pane', async () => (await tabs()) === 1 && (await panes()) === 4);
    // Through it all the session keeps its panes: its next show lands in one, and no pane or tab is opened for it.
    const before = await page.evaluate<string>(`[...document.querySelectorAll('.pane-follows')].filter((m) => m.textContent === 'Session ${name}').length + ''`);
    assert.ok(Number(before) >= 1, 'a pane still says it is the session’s');
    await show({ lens: { filter: { text: 'Something' } }, note: 'Still here' });
    await until('it landed in its own pane', () => page.evaluate<boolean>(`[...document.querySelectorAll('.pane-follows')].some((m) => m.title === 'Still here')`));
    assert.deepEqual([await tabs(), await panes()], [1, 4]);
  } finally {
    await page.close();
  }
});
