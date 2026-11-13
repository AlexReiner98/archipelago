// A chat's tab over its life (the panes part, packs/panes/parts/life.js, the tab lifecycle e_p6fr4uye): opened by its first show, out of sight;
// closed by hand or gone quiet it stays closed until its next show; it ends with the chat. Beside test/show-lands.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { until as holds } from './wait.ts';
import { serve } from './serve.ts';
import { TAB, agent, called, heard, ready, tabAt } from './tab-page.ts';

const browser = chrome();

test('in a browser, a chat has a tab once it shows something, out of sight; closed by hand or gone quiet it stays closed until its next show; it ends with the chat', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'work', title: 'Something shown' }] })).result.created as Record<string, string>;
  const page = await open(`${base}/`);
  const strip = () => page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('${TAB} [data-key^="front:"]')].map((t) => t.textContent))`).then(JSON.parse).then(called);
  const until = async (what: string, ok: (names: string[]) => boolean) => {
    if (!(await holds(() => strip().then(ok), 20_000, 250))) assert.fail(`${what}: ${JSON.stringify(await strip())} ${page.logs().join(' ')}`);
  };
  try {
    await ready(page);
    const before = await page.evaluate<string>('location.hash');
    const { run } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'tab-one', surface: 'claude-code', title: 'Tab one' } })).result;
    await heard(page);
    assert.ok(!(await strip()).includes('Tab one'), 'a chat that has shown nothing has no tab');
    await call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made.a, run, focus: false } });
    await until('its tab', (names) => names.includes('Tab one'));
    assert.equal(await page.evaluate<string>('location.hash'), before, 'the reader stays where they were');
    await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'tab-one', surface: 'claude-code' } });
    await call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made.a, run, focus: false } });
    await heard(page);
    assert.equal(await page.evaluate<string>('location.hash'), before, 'its shows go to its tab, not the one in sight');
    assert.equal((await strip()).filter((t) => t === 'Tab one').length, 1, 'taking it up again opens no second tab');
    // Closed by hand, it stays closed, a reload too, until the chat next shows something.
    await page.evaluate(`${tabAt(2)}.querySelector('[data-key^="close:"]').click()`);
    await until('closed', (names) => !names.includes('Tab one'));
    await page.evaluate('(window.beforeReload = true, location.reload())');
    assert.ok(await page.until('!window.beforeReload'), 'reloaded');
    await ready(page);
    assert.ok(!(await strip()).includes('Tab one'), 'a reload does not bring it back');
    await call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made.a, run, focus: false } });
    await until('its show brings it back', (names) => names.includes('Tab one'));
    // Its agent says where its work stands: the chat goes on, waiting, and its tab goes until it shows something again.
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run, summary: 'Done for now', cannot_tell_rest: true } });
    await until('gone while it waits', (names) => !names.includes('Tab one'));
    await call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made.a, run, focus: false } });
    await until('back with its show', (names) => names.includes('Tab one'));
    // The chat ends: its tab goes.
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run, reason: 'closed', cannot_tell_rest: true } });
    await until('gone with the chat', (names) => !names.includes('Tab one'));
  } finally {
    await page.close();
  }
});
