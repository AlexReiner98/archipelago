// How a reader hears of an agent's show (ui/live.js, ui/pane-land.js): no line at the foot, a note on the pane in its
// chat's tab, a page that is no canvas opened there, a show held while a question is open; and a chat's tab merged into
// the owner's, whose pane goes with the chat as it ends while the owner's stay (ui/tab-bar.js, ui/tab-life.js, the tab
// lifecycle e_p6fr4uye). The rest of how a show lands is in test/show-tab-life.test.ts, test/show-follows.test.ts and
// test/show-web.test.ts: each test in a file of its own, as the steps a server keeps outlive a test in one process, so
// a session of one would be heard by a page in another.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { until as holds } from './wait.ts';
import { serve } from './serve.ts';
import { agent, heard, press, ready } from './tab-page.ts';

const browser = chrome();

test('in a browser, a show lands in its chat’s tab without a line at the foot, and a chat merged into the owner’s tab leaves it as it ends', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'work', title: 'Something shown' }] })).result.created as Record<string, string>;
  const { run } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'no-line', title: 'No line' } })).result;
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const show = (params: Record<string, unknown>) => call('/agent/report', undefined, { actor: agent, action: 'show', params: { ...params, run } });
  const tabs = () => page.evaluate<number>(`document.querySelectorAll('#tabs .tab').length`);
  const panes = () => page.evaluate<number>(`document.querySelectorAll('#canvas > .pane').length`);
  try {
    // The page follows steps from its first look at the map on.
    await ready(page);
    // A show lands in its chat's tab, opened for it out of sight; the note is on the pane, in its mark's tooltip.
    await show({ entity: made.a, note: 'What the note says' });
    await until('the chat has a tab', async () => (await tabs()) === 2);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('#followed, #follow'))`), false, 'no line, and nothing in the menu to turn it on');
    assert.equal(await panes(), 1, 'the owner’s tab stays as it was');
    await press(page, '#tabs .tab:nth-child(2) .tab-name');
    await until('its tab in sight', () => page.evaluate<boolean>(`document.querySelector('#tabs .tab:nth-child(2)').getAttribute('aria-selected') === 'true'`));
    await until('the note on its pane', () => page.evaluate<boolean>(`document.querySelector('#canvas > .pane .pane-follows')?.title === 'What the note says'`));
    // A page that is no canvas opens over its chat's tab.
    await show({ screen: 'workspace' });
    await until('the workspace is open in it', () => page.evaluate<boolean>(`location.hash.startsWith('#/workspace')`));
    assert.equal(await tabs(), 2);
    // A question open over the page holds a show: it lands once the question is answered.
    await page.evaluate(`(() => { const d = document.createElement('dialog'); d.id = 'held'; document.body.append(d); d.showModal(); })()`);
    await show({ entity: made.a, pane: 'after' });
    await heard(page);
    assert.equal(await page.evaluate(`Boolean([...document.querySelectorAll('.pane-follows')].some((m) => m.textContent === 'after'))`), false, 'nothing lands while it is open');
    await page.evaluate(`document.getElementById('held').close()`);
    await until('it lands', () => page.evaluate<boolean>(`[...document.querySelectorAll('.pane-follows')].some((m) => m.textContent === 'after')`));
    const theirs = await panes();
    // Merge into, in ⋯: the chat's panes join the owner's tab, which comes into sight, and the chat's tab is gone.
    await page.evaluate(`document.querySelector('#tabs .tab:nth-child(2) [aria-label="This tab: whom it follows, pop it out"]').click()`);
    assert.ok(await page.until(`[...document.querySelectorAll('.tab-menu [role="menuitem"]')].some((b) => b.textContent === 'Home')`), 'the menu offers Home');
    await page.evaluate(`[...document.querySelectorAll('.tab-menu [role="menuitem"]')].find((b) => b.textContent === 'Home').click()`);
    await until('merged', async () => (await tabs()) === 1 && (await panes()) === theirs + 1);
    // Its next show finds its panes there: no tab is opened for it.
    await show({ lens: { filter: { find: ['text Something'] } }, note: 'Still here' });
    await until('it landed in its own pane', () => page.evaluate<boolean>(`[...document.querySelectorAll('.pane-follows')].some((m) => m.title === 'Still here')`));
    assert.equal(await tabs(), 1);
    // The reader works in their own pane; the chat ends: its panes go, the owner's stays, and so does their tab.
    await press(page, '#canvas > .pane:first-of-type .pane-canvas');
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run, reason: 'closed', cannot_tell_rest: true } });
    await until('its panes are gone', async () => (await panes()) === 1);
    assert.equal(await tabs(), 1);
    assert.equal(await page.evaluate(`document.querySelector('#tabs .tab').dataset.ended ?? null`), null, 'the owner’s tab is not struck');
  } finally {
    await page.close();
  }
});
