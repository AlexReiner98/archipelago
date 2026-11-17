// How a reader hears of an agent's show (packs/surface/page/live.js tells the panes part, packs/panes/parts/life.js): no
// line at the foot, its chat's tab drawing it, a page that is no canvas opened there, a show held while a question is
// open, and the chat's tab gone as it ends while the owner's stays (the tab lifecycle e_p6fr4uye). The rest of how a
// show lands is in test/show-tab-life.test.ts and test/show-web.test.ts: each test in a file of its own, as the steps a
// server keeps outlive a test in one process, so a session of one would be heard by a page in another.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { until as holds } from './wait.ts';
import { serve } from './serve.ts';
import { PANE, TAB, agent, heard, press, ready, tabAt, tabName } from './tab-page.ts';

const browser = chrome();

test('in a browser, a show lands in its chat’s tab without a line at the foot, and its tab goes as it ends', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'work', title: 'Something shown' }] })).result.created as Record<string, string>;
  const { run } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'no-line', title: 'No line' } })).result;
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const show = (params: Record<string, unknown>) => call('/agent/report', undefined, { actor: agent, action: 'show', params: { ...params, run } });
  const tabs = () => page.evaluate<number>(`document.querySelectorAll('${TAB}').length`);
  const panes = () => page.evaluate<number>(`document.querySelectorAll('${PANE}').length`);
  try {
    // The page follows steps from its first look at the map on.
    await ready(page);
    // A show lands in its chat's tab, opened for it out of sight.
    await show({ entity: made.a, note: 'What the note says' });
    await until('the chat has a tab', async () => (await tabs()) === 2);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('#followed, #follow'))`), false, 'no line, and nothing in the menu to turn it on');
    assert.equal(await panes(), 1, 'the owner’s tab stays as it was');
    await press(page, await tabName(page, 2));
    await until('its tab in sight', () => page.evaluate<boolean>(`${tabAt(2)}.getAttribute('aria-selected') === 'true'`));
    await until('it draws what was shown', () => page.evaluate<boolean>(`location.hash.includes('${made.a}')`));
    // A page that is no canvas opens over its chat's tab.
    await show({ screen: 'workspace' });
    await until('the workspace is open in it', () => page.evaluate<boolean>(`location.hash.startsWith('#/workspace')`));
    assert.equal(await tabs(), 2);
    // A question open over the page holds a show: it lands once the question is answered.
    await page.evaluate(`(() => { const d = document.createElement('dialog'); d.id = 'held'; document.body.append(d); d.showModal(); })()`);
    await show({ screen: 'you' });
    await heard(page);
    assert.ok(await page.evaluate<boolean>(`location.hash.startsWith('#/workspace')`), 'nothing lands while it is open');
    await page.evaluate(`document.getElementById('held').close()`);
    await until('it lands', () => page.evaluate<boolean>(`location.hash.startsWith('#/you')`));
    // The chat ends: its tab goes, and the owner's stays, not struck.
    await press(page, await tabName(page, 1));
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run, reason: 'closed', cannot_tell_rest: true } });
    await until('its tab is gone', async () => (await tabs()) === 1);
    assert.equal(await panes(), 1);
    assert.equal(await page.evaluate(`${tabAt(1)}.className.includes('closed')`), false, 'the owner’s tab is not struck');
  } finally {
    await page.close();
  }
});
