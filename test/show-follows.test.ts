// The Follows menu of a tab (the panes part's strip, packs/panes/parts/strip.js): the chats open now, by title. Beside test/show-lands.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import { agent, called, menuOf, ready, tabAt, wait } from './tab-page.ts';

const browser = chrome();

test('in a browser, the Follows menu lists the chats open now, by title', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const start = async (id: string, title: string) => (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: id, title } })).result;
  const ending = await start('will-end', 'Will end');
  await start('stays-quiet', 'Stays quiet');
  const page = await open(`${base}/`);
  const menu = () => page.evaluate<string>(`JSON.stringify(${menuOf(tabAt(1))}.filter((b) => b.dataset.key.startsWith('follow:')).map((b) => b.textContent))`).then(JSON.parse).then(called);
  const opened = async (ok: (names: string[]) => boolean) => {
    for (let n = 0; n < 40; n++) {
      const names = await menu();
      if (ok(names)) return names;
      await wait(200);
    }
    assert.fail(`the menu: ${JSON.stringify(await menu())} ${page.logs().join('\n')}`);
  };
  try {
    await ready(page);
    await opened((names) => names.includes('Will end') && names.includes('Stays quiet'));
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run: ending.run, reason: 'closed', cannot_tell_rest: true } });
    const names = await opened((list) => !list.includes('Will end'));
    assert.deepEqual(names, ['Nobody', 'Sessions in what it draws', 'Stays quiet'], 'an ended chat leaves it; Everyone is gone, every chat having a tab of its own, and a tab may watch what it draws');
  } finally {
    await page.close();
  }
});
