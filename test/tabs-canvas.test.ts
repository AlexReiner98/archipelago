// A new session's tab opens on its canvas, with no page over it (ui/tab-life.js). Beside test/tabs.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import { agent, wait } from './tab-page.ts';

const browser = chrome();

test('in a browser, a new session’s tab opens on its canvas, with no page over it', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const page = await open(`${base}/`);
  try {
    await wait(3000);
    const started = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'tab-canvas' } })).result;
    const task = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', type: 'work', title: 'A task' }] })).result.created as Record<string, string>;
    const id = Object.values(task)[0];
    const count = () => page.evaluate<number>(`document.querySelectorAll('#tabs .tab').length`);
    await wait(2500);
    assert.equal(await count(), 1, 'no tab while it has shown nothing');
    await call('/agent/report', undefined, { actor: agent, action: 'show', params: { query: {}, run: started.run } });
    for (let n = 0; n < 60 && (await count()) < 2; n++) await wait(250);
    assert.equal(await count(), 2, 'a tab of its own');
    await call('/agent/report', undefined, { actor: agent, action: 'session_update', params: { run: started.run, task: id } });
    await wait(3000);
    await page.evaluate(`document.querySelector('#tabs .tab:nth-child(2)').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    for (let n = 0; n < 20 && (await page.evaluate<string>(`document.querySelector('#tabs .tab:nth-child(2)').getAttribute('aria-selected')`)) !== 'true'; n++) await wait(250);
    assert.equal(await page.evaluate<string>(`document.querySelector('#tabs .tab:nth-child(2)').getAttribute('aria-selected')`), 'true', 'brought into sight');
    assert.ok(!(await page.evaluate<string>('location.hash')).startsWith('#/e/'), `no page over it: ${await page.evaluate('location.hash')}`);
    assert.notEqual(await page.evaluate('document.body.dataset.sheet'), 'open');
  } finally {
    await page.close();
  }
});
