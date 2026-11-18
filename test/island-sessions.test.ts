// The chats at work in the island side bar, in a real browser (packs/surface/page/island-sessions.js, sessions-open.js;
// decision e_mnuthcap, Alex, 17 Nov 2026): a Sessions part after On, a row a chat on one line with its state's mark (what waits on you the inbox),
// the count of those waiting on the owner in the band beside the islands button; and an island a show lit
// (hooks.lightIsland) marked in the list until it is pressed, the press bringing the canvas to it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import { until as holds } from './wait.ts';
import { agent } from './agent-page.ts';

const browser = chrome();

test('in a browser, the side bar lists the chats at work and the band counts those waiting on you', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  await call('/api/workspace_set', undefined, { islands: true });
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'harbour', type: 'island', title: 'Harbour works', props: { pack: 'core' } }, { op: 'create', ref: 'pier', type: 'task', title: 'Rebuild the pier', props: { island: '{harbour}' } }] })).result.created as Record<string, string>;
  const titles = ['Pick the signup copy', 'Rebalance CI shards for faster tests with a title that runs on and on'];
  for (const [n, title] of titles.entries()) await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: `side-${n}`, title, surface: 'codex', ...(n === 1 && { task: made.pier }) } });
  // The first chat's turn ended on a question: its move is the owner's.
  const at = new Date().toISOString();
  await call('/hooks/events', undefined, { session_id: 'side-0', source: 'claude-code', events: [{ at, kind: 'turn.start', turn: 't1', by: 'person' }, { at, kind: 'turn.end', turn: 't1', ended: 'asked', question: 'Which copy?' }] });
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  /** The pieces each chat's row is drawn from, in the order drawn. */
  const pieces = `[...document.querySelectorAll('#islands .isl-chat')].map((r) => [...r.children].map((c) => c.dataset.piece))`;
  /** The chats' rows: their state, mark and name, and whether each stands on one line. */
  const chats = `[...document.querySelectorAll('#islands .isl-chat')].map((r) => ({ state: r.dataset.state, mark: r.querySelector('.isl-chat-mark.on-you') && getComputedStyle(r.querySelector('.isl-chat-mark')).maskImage.includes('inbox.svg') ? 'inbox' : r.querySelector('.isl-chat-mark').textContent, name: r.querySelector('.isl-name').textContent, line: r.scrollHeight <= r.clientHeight + 1 && r.querySelector('.isl-name').scrollWidth >= r.querySelector('.isl-name').clientWidth }))`;
  try {
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await until('the side bar and its button', () => page.evaluate<boolean>(`Boolean(document.getElementById('islands') && document.querySelector('#query .isl-toggle'))`));
      await page.evaluate(`document.body.dataset.islands === 'open' || document.querySelector('#query .isl-toggle').click()`);
      await until(`the chats at ${width} px`, () => page.evaluate<boolean>(`document.querySelectorAll('#islands .isl-chat .isl-name').length === 2`)); // filled once its pieces have loaded
      const rows = await page.evaluate<{ state: string; mark: string; name: string; line: boolean }[]>(chats);
      // The one waiting on the owner first, by its mark; every row on one line.
      // (A run's title is cut at 60 characters when it is made: its start is compared.)
      assert.deepEqual(rows.map((r) => [r.state, r.mark, r.name.slice(0, 30)]), [['your_move', 'inbox', titles[0]], ['idle', '', titles[1].slice(0, 30)]], `at ${width} px`);
      assert.ok(rows.every((r) => r.line), `one line a row at ${width} px`);
      // Each part of a row is a piece (./session-pieces.js), in the house style's order (rows.sessions).
      assert.deepEqual(await page.evaluate(pieces), [['inbox', 'name'], ['state', 'name', 'on']], `pieces at ${width} px`);
      assert.match(await page.evaluate<string>(`[...document.querySelectorAll('#islands .isl-head')].map((h) => h.textContent).join(' | ')`), /^On · \d+ \| Sessions · 2/, 'Sessions after On');
      // The band counts the one waiting on the owner, beside the islands button: the inbox, its count a badge.
      assert.equal(await page.evaluate<string>(`document.querySelector('#query .q-waiting .q-waiting-badge').textContent`), '1');
      assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#query button:not([hidden])')].map((b) => b.getAttribute('aria-label')?.split(':')[0] ?? b.textContent)`), ['Islands', '1 waiting on you', 'Back', 'Forward']);
      await page.evaluate(`document.body.dataset.islands === 'open' && document.querySelector('#query .isl-toggle').click()`);
    }
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.evaluate(`document.body.dataset.islands === 'open' || document.querySelector('#query .isl-toggle').click()`);
    // Who is on a task, seen where it stands (e_vr7tpgxp): a chat's row names its work after its name, and pointing at
    // the row lights that work on the canvas.
    const second = `document.querySelectorAll('#islands .isl-chat')[1]`;
    assert.equal(await page.evaluate<string>(`${second}.querySelector('.isl-chat-on')?.textContent`), 'Rebuild the pier');
    assert.match(await page.evaluate<string>(`${second}.title`), /^Rebalance CI shards[^\n]*\n.*\non Rebuild the pier$/);
    // Named in the chat's hue, the one its name gives it everywhere (sessionHue).
    const hue = await page.evaluate<string>(`${second}.querySelector('.isl-chat-on').style.getPropertyValue('--session-hue')`);
    assert.match(hue, /^#[0-9a-f]{6}$/i, "the work in the chat's hue");
    await page.evaluate(`${second}.dispatchEvent(new PointerEvent('pointerenter'))`);
    await until('its work lit', () => page.evaluate<boolean>(`Boolean(document.querySelector('[data-lighting]'))`));
    await page.evaluate(`${second}.dispatchEvent(new PointerEvent('pointerleave'))`);
    await until('the lighting off', () => page.evaluate<boolean>(`!document.querySelector('[data-lighting]')`));
    // The style sets the pieces and their order: a piece left out is not drawn, one named with no module draws nothing.
    const styled = await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', type: 'style', title: 'Names first', status: 'current', props: { rows: { sessions: ['name', 'state', 'nothing_here'] } } }] });
    assert.equal(styled.result?.status, 'applied', JSON.stringify(styled).slice(0, 300));
    await page.evaluate('location.reload()');
    await until('the side bar after the reload', () => page.evaluate<boolean>(`Boolean(document.querySelector('#query .isl-toggle'))`));
    await page.evaluate(`document.body.dataset.islands === 'open' || document.querySelector('#query .isl-toggle').click()`);
    await until("the rows in the style's order", () => page.evaluate<boolean>(`JSON.stringify(${pieces}) === '[["name"],["name","state"]]'`));
    // A show lights the island it added: its row is marked, the view not moved; a press goes there and clears it.
    const version = `new URL(document.querySelector('link[href^="/base.js"]').href).search`;
    const before = await page.evaluate<string>('location.hash');
    await page.evaluate(`import('/base.js' + ${version}).then(({ hooks }) => hooks.lightIsland(${JSON.stringify(made.harbour)}, ${JSON.stringify(made.pier)}, 'Skye'))`);
    const lit = `document.querySelector('#islands .isl-row.shown[data-id="${made.harbour}"]')`;
    await until('the island lit', () => page.evaluate<boolean>(`Boolean(${lit})`));
    assert.match(await page.evaluate<string>(`${lit}.querySelector('.isl-name').title`), /^Skye showed: /);
    assert.equal(await page.evaluate<string>('location.hash'), before, 'the view did not move');
    await page.evaluate(`${lit}.querySelector('.isl-name').click()`);
    await until('pressed, the mark is gone', () => page.evaluate<boolean>(`!${lit}`));
  } finally {
    await page.close();
  }
});
