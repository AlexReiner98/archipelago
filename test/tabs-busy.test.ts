// A show while the reader is at work in its chat's tab waits for them (ui/pane-busy.js, ui/pane-route.js), and lands
// once they are quiet: a chat has one tab. Beside test/tabs.test.ts, in a file of its own as it waits out the while a
// press counts as work.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import { agent, press, wait } from './tab-page.ts';

const browser = chrome();

test('in a browser, a chat’s show waits while the reader is at work in its tab, and lands when they are quiet', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: ['First', 'Second'].map((t, n) => ({ op: 'create', ref: `i${n}`, type: 'work', title: `${t} step` })),
  })).result.created as Record<string, string>;
  const { run } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'tabs-busy', title: 'Chat 1', surface: 'codex' } })).result;
  const page = await open(`${base}/`);
  const tabs = () => page.evaluate<number>(`document.querySelectorAll('#tabs .tab').length`);
  const hash = () => page.evaluate<string>(`location.hash`);
  const show = (item: string) => call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made[item], run } });
  try {
    await wait(3000);
    await show('i1');
    for (let n = 0; n < 60 && (await tabs()) < 2; n++) await wait(250);
    assert.equal(await tabs(), 2, 'its tab');
    // A press brings it into sight, where its chat last showed.
    await press(page, '#tabs .tab:nth-child(2) .tab-name');
    for (let n = 0; n < 60 && !(await hash()).startsWith(`#/e/${made.i1}`); n++) await wait(250);
    assert.ok((await hash()).startsWith(`#/e/${made.i1}`), `the chat’s tab is in sight: ${await hash()} ${page.logs().join('\n')}`);
    // While the reader is at work in it, its chat's next show waits: a chat has one tab.
    await press(page, '#canvas .pane-canvas');
    await show('i0');
    await wait(4000);
    assert.equal(await tabs(), 2, 'no second tab for the chat');
    for (const end = Date.now() + 30000; Date.now() < end && !(await hash()).startsWith(`#/e/${made.i0}?`); ) await wait(250);
    assert.ok((await hash()).startsWith(`#/e/${made.i0}?`), 'the show lands when the reader is quiet');
  } finally {
    await page.close();
  }
});
