// Tabs at the top of the owner's page (the panes part, packs/panes/parts/index.js and life.js; decisions e_mzer5m4t, e_q3amet26, e_ezb7s3a7,
// e_xjrpyysn, and the tab lifecycle e_p6fr4uye): in a real browser (skipped where there is no Chrome), every chat that
// has shown something has a tab named by its title, kept live as it is renamed and closed as it ends; its shows land there in the background
// and marked, and a press brings a tab into sight. A show
// while the reader is at work in its chat's tab waits for them (test/tabs-busy.test.ts); a new session's tab opens on
// its canvas (test/tabs-canvas.test.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { until as holds } from './wait.ts';
import { serve } from './serve.ts';
import { TAB, agent, heard, press, ready } from './tab-page.ts';

const browser = chrome();

test('in a browser, every chat that shows something has a tab named by its title, kept live, closed as it ends', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: ['First', 'Second', 'Third'].map((t, n) => ({ op: 'create', ref: `i${n}`, type: 'work', title: `${t} step` })),
  })).result.created as Record<string, string>;
  const sessions: { run: string }[] = [];
  for (const n of [0, 1, 2]) sessions.push((await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: `tabs-${n}`, title: `Chat ${n}`, surface: 'codex' } })).result);
  const page = await open(`${base}/`);
  /** The strip as the reader sees it: each tab's name, whether it is in sight, and marked. */
  const strip = () => page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('${TAB}')].map((t) => [t.querySelector('[data-key^="front:"]').textContent, t.getAttribute('aria-selected') === 'true', t.classList.contains('pm-ring')]))`).then(JSON.parse) as Promise<[string, boolean, boolean][]>;
  const names = async () => (await strip()).map((t) => t[0]);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${JSON.stringify(await strip())} ${page.logs().join('\n')}`);
  };
  const show = (n: number, item: string) => call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made[item], run: sessions[n].run } });
  /** The tab named `name`, as an expression of the page. */
  const tabNamed = (name: string) => `[...document.querySelectorAll('${TAB}')].find((t) => t.querySelector('[data-key^="front:"]').textContent === ${JSON.stringify(name)})`;
  /** Its name, as a selector to press. */
  const nameOf = async (name: string) => `[data-key="front:${(await page.evaluate<string>(`${tabNamed(name)}.dataset.key`)).slice(4)}"]`;
  try {
    // The page follows steps from its first look at the map on. A chat open that has shown nothing has no tab.
    await ready(page);
    assert.equal((await strip()).length, 1);
    const reader = await page.evaluate<string>('location.hash');
    // Each chat's first show opens its tab: the owner's tab first, then one for each, by its title, out of sight and marked.
    for (const n of [0, 1, 2]) await show(n, `i${n}`);
    // A tab may be drawn a moment before its mark: wait for both, so a slow runner does not read a tab not yet marked.
    await until('a tab for each chat, out of sight and marked', async () => { const s = await strip(); return s.length === 4 && s.slice(1).every((t) => !t[1] && t[2]); });
    const now = await strip();
    assert.equal(now[0][0], 'Home');
    assert.deepEqual(now.slice(1).map((t) => t[0]).sort(), ['Chat 0', 'Chat 1', 'Chat 2']);
    assert.deepEqual(now.map((t) => [t[1], t[2]]), [[true, false], [false, true], [false, true], [false, true]], 'the tab in sight stays; the others are marked');
    // A show goes to its chat's tab, in the background: no tab is added and the reader stays.
    await show(1, 'i1');
    await heard(page);
    assert.equal((await strip()).length, 4);
    assert.equal(await page.evaluate(`location.hash`), reader);
    // A press brings it into sight, where its chat last showed.
    await press(page, await nameOf('Chat 1'));
    await until('the chat’s tab is in sight', async () => (await page.evaluate<string>(`location.hash`)).startsWith(`#/e/${made.i1}`));
    // A rename reaches the tab at once.
    await call('/agent/report', undefined, { actor: agent, action: 'session_update', params: { run: sessions[2].run, title: 'Chat two, renamed' } });
    await until('the tab follows the rename', async () => (await names()).includes('Chat two, renamed'));
    // A chat that ends out of sight takes its tab with it.
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run: sessions[0].run, reason: 'closed', cannot_tell_rest: true } });
    await until('its tab is gone', async () => !(await names()).includes('Chat 0'));
  } finally {
    await page.close();
  }
});
