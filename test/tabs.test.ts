// Tabs at the top of the owner's page (ui/tab-bar.js, ui/tab-life.js; decisions e_mzer5m4t, e_q3amet26, e_ezb7s3a7,
// e_xjrpyysn, and the tab lifecycle e_p6fr4uye): in a real browser (skipped where there is no Chrome), every chat that
// has shown something has a tab named by its title, kept live as it is renamed and closed as it ends; its shows land there in the background
// and marked, a press brings a tab into sight, and a tab pops out into a window of its own and docks back whole. A show
// while the reader is at work in its chat's tab waits for them (test/tabs-busy.test.ts); a new session's tab opens on
// its canvas (test/tabs-canvas.test.ts); a tab merged is test/show-lands.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import { agent, press, wait } from './tab-page.ts';

const browser = chrome();

test('in a browser, every chat that shows something has a tab named by its title, kept live, closed as it ends, which pops out and docks back', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: ['First', 'Second', 'Third'].map((t, n) => ({ op: 'create', ref: `i${n}`, type: 'work', title: `${t} step` })),
  })).result.created as Record<string, string>;
  const sessions: { run: string }[] = [];
  for (const n of [0, 1, 2]) sessions.push((await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: `tabs-${n}`, title: `Chat ${n}`, surface: 'codex' } })).result);
  const page = await open(`${base}/`);
  /** The strip as the reader sees it: each tab's name, whether it is in sight, marked, or out in a window. */
  const strip = () => page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('#tabs .tab')].map((t) => [t.querySelector('.tab-name').textContent, t.getAttribute('aria-selected') === 'true', Boolean(t.dataset.unseen), t.classList.contains('tab-out')]))`).then(JSON.parse) as Promise<[string, boolean, boolean, boolean][]>;
  const names = async () => (await strip()).map((t) => t[0]);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    for (let n = 0; n < 60; n++) if (await ok()) return;
    else await wait(250);
    assert.fail(`${what}: ${JSON.stringify(await strip())} ${page.logs().join('\n')}`);
  };
  const show = (n: number, item: string) => call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made[item], run: sessions[n].run } });
  /** The tab named `name`, as a selector. */
  const tabNamed = async (name: string) => `#tabs .tab:nth-child(${(await names()).indexOf(name) + 1})`;
  try {
    // The page follows steps from its first look at the map on. A chat open that has shown nothing has no tab.
    await wait(3000);
    assert.equal((await strip()).length, 1);
    const reader = await page.evaluate<string>('location.hash');
    // Each chat's first show opens its tab: the owner's tab first, then one for each, by its title, out of sight and marked.
    for (const n of [0, 1, 2]) await show(n, `i${n}`);
    await until('a tab for each chat', async () => (await strip()).length === 4);
    const now = await strip();
    assert.equal(now[0][0], 'Home');
    assert.deepEqual(now.slice(1).map((t) => t[0]).sort(), ['Chat 0', 'Chat 1', 'Chat 2']);
    assert.deepEqual(now.map((t) => [t[1], t[2]]), [[true, false], [false, true], [false, true], [false, true]], 'the tab in sight stays; the others are marked');
    // A show goes to its chat's tab, in the background: no tab is added and the reader stays.
    await show(1, 'i1');
    await wait(2000);
    assert.equal((await strip()).length, 4);
    assert.equal(await page.evaluate(`location.hash`), reader);
    // A press brings it into sight, where its chat last showed.
    await press(page, `${await tabNamed('Chat 1')} .tab-name`);
    await until('the chat’s tab is in sight', async () => (await page.evaluate<string>(`location.hash`)).startsWith(`#/e/${made.i1}`));
    // A rename reaches the tab at once.
    await call('/agent/report', undefined, { actor: agent, action: 'session_update', params: { run: sessions[2].run, title: 'Chat two, renamed' } });
    await until('the tab follows the rename', async () => (await names()).includes('Chat two, renamed'));
    // A chat that ends out of sight takes its tab with it.
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run: sessions[0].run, reason: 'closed', cannot_tell_rest: true } });
    await until('its tab is gone', async () => !(await names()).includes('Chat 0'));
    // The tab in sight pops out into a window of its own, and docks back whole.
    await page.send('Target.setDiscoverTargets', { discover: true });
    await press(page, `${await tabNamed('Chat 1')} [aria-label="This tab: whom it follows, pop it out"]`);
    await wait(1000);
    await page.evaluate(`[...document.querySelectorAll('.tab-menu [role="menuitem"]')].find((b) => b.textContent === 'Pop out').click()`);
    await until('the tab is out', async () => (await strip()).some((t) => t[3]));
    const targets = (await page.send('Target.getTargets')).result.targetInfos as { targetId: string; type: string; url: string }[];
    const popped = targets.find((t) => t.type === 'page' && t.url.includes(`/e/${made.i1}`));
    assert.ok(popped, 'a window was opened on the tab’s canvas');
    const { sessionId } = (await page.send('Target.attachToTarget', { targetId: popped.targetId, flatten: true })).result;
    const inPopped = async (expression: string) => (await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result?.result?.value;
    for (let n = 0; n < 40 && !(await inPopped(`Boolean(document.querySelector('[aria-label="Dock back"]'))`)); n++) await wait(250);
    await inPopped(`document.querySelector('[aria-label="Dock back"]').click()`);
    await until('the tab docked back, in sight', async () => {
      const at = await strip();
      return at.length === 3 && !at.some((t) => t[3]) && at.some((t) => t[0] === 'Chat 1' && t[1]);
    });
  } finally {
    await page.close();
  }
});
