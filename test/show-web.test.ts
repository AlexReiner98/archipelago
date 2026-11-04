// A show of a web address (ui/pane-web.js): framed in its chat's pane, and its answer says whether the owner is looking
// at that tab. Beside test/show-lands.test.ts.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import { agent, press, wait } from './tab-page.ts';

const browser = chrome();

test('in a browser, a show frames a web address in its pane, and says whether the owner is looking at that tab', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  // A build being made, on this machine: what a dev server serves.
  const build = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Build</title><p id="built">Built</p>'));
  await new Promise<void>((done) => build.listen(0, '127.0.0.1', done));
  const url = `http://localhost:${(build.address() as AddressInfo).port}/sketch`;
  const { run } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'web-show', title: 'Web show' } })).result;
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    for (let n = 0; n < 60; n++) if (await ok()) return;
    else await wait(250);
    assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const show = async (params: Record<string, unknown>) => (await call('/agent/report', undefined, { actor: agent, action: 'show', params: { ...params, run } })).result;
  try {
    await wait(3000);
    const first = await show({ url, note: 'The build' });
    assert.equal(first.sight.looking, false, 'its first show opens a tab of its own, out of sight');
    await until('the chat has a tab', () => page.evaluate<boolean>(`document.querySelectorAll('#tabs .tab').length === 2`));
    await press(page, '#tabs .tab:nth-child(2) .tab-name');
    await until('the page framed in its pane', () => page.evaluate<boolean>(`document.querySelector('#canvas > .pane iframe.pane-web')?.src === ${JSON.stringify(url)}`));
    assert.equal(await page.evaluate(`document.querySelector('#canvas > .pane .pane-name').textContent`), new URL(url).host, 'named by its host');
    assert.equal(await page.evaluate(`document.querySelector('#canvas > .pane a.pane-act')?.href`), url, 'and ↗ opens it in a window of its own');
    assert.equal(await page.evaluate(`document.querySelector('#canvas > .pane .pane-canvas').hidden`), true, 'in place of the canvas');
    // Its tab in sight now: a show says the owner is looking at it, once the page has said so with its beat.
    const sees = async (looking: boolean) => {
      for (let n = 0; n < 30; n++) if ((await show({ url })).sight.looking === looking) return;
      else await wait(500);
      assert.fail(`sight never ${looking}: ${page.logs().join(' ')}`);
    };
    await sees(true);
    // Back on the owner's tab, a show lands out of sight, and says so.
    await press(page, '#tabs .tab:nth-child(1) .tab-name');
    await sees(false);
    // Asked to be taken there, a show with focus brings its tab into sight, and its answer says they are looking.
    const brought = await show({ url, focus: true });
    assert.equal(brought.sight.looking, true, `brought into sight: ${brought.sight.where}`);
    assert.equal(await page.evaluate(`document.querySelector('#tabs .tab:nth-child(2)').getAttribute('aria-selected') === 'true'`), true, "the chat's tab is the one in sight");
  } finally {
    await page.close();
    build.close();
  }
});
