// How a reader hears of an agent's show (ui/live.js, ui/pane-land.js): no line at the foot, a note on the pane in its
// chat's tab, a page that is no canvas opened there, a show held while a question is open; and a chat's tab merged into
// the owner's, whose pane goes with the chat as it ends while the owner's stay (ui/tab-bar.js, ui/tab-life.js, the tab
// lifecycle e_p6fr4uye). In a file of its own: the steps a server keeps outlive a test in one process, so a session
// here would be heard by a page in another test.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();
/** A session as the page calls it, without the run it adds when a session of an earlier test goes by the same title. */
const called = (names: string[]) => names.map((n) => n.replace(/ · \w{4}$/, ''));

test('in a browser, a show lands in its chat’s tab without a line at the foot, and a chat merged into the owner’s tab leaves it as it ends', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'work', title: 'Something shown' }] })).result.created as Record<string, string>;
  const agent = 'agent:claude-code/archipelago';
  const { run } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'no-line', title: 'No line' } })).result;
  const page = await open(`${base}/`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: string, ok: () => Promise<boolean>) => {
    for (let n = 0; n < 60; n++) if (await ok()) return;
    else await wait(250);
    assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const show = (params: Record<string, unknown>) => call('/agent/report', undefined, { actor: agent, action: 'show', params: { ...params, run } });
  const tabs = () => page.evaluate<number>(`document.querySelectorAll('#tabs .tab').length`);
  const panes = () => page.evaluate<number>(`document.querySelectorAll('#canvas > .pane').length`);
  const press = async (selector: string) => {
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  };
  try {
    // The page follows steps from its first look at the map on.
    await wait(3000);
    // A show lands in its chat's tab, opened for it out of sight; the note is on the pane, in its mark's tooltip.
    await show({ entity: made.a, note: 'What the note says' });
    await until('the chat has a tab', async () => (await tabs()) === 2);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('#followed, #follow'))`), false, 'no line, and nothing in the menu to turn it on');
    assert.equal(await panes(), 1, 'the owner’s tab stays as it was');
    await press('#tabs .tab:nth-child(2) .tab-name');
    await until('its tab in sight', () => page.evaluate<boolean>(`document.querySelector('#tabs .tab:nth-child(2)').getAttribute('aria-selected') === 'true'`));
    await until('the note on its pane', () => page.evaluate<boolean>(`document.querySelector('#canvas > .pane .pane-follows')?.title === 'What the note says'`));
    // A page that is no canvas opens over its chat's tab.
    await show({ screen: 'workspace' });
    await until('the workspace is open in it', () => page.evaluate<boolean>(`location.hash.startsWith('#/workspace')`));
    assert.equal(await tabs(), 2);
    // A question open over the page holds a show: it lands once the question is answered.
    await page.evaluate(`(() => { const d = document.createElement('dialog'); d.id = 'held'; document.body.append(d); d.showModal(); })()`);
    await show({ entity: made.a, pane: 'after' });
    await wait(3000);
    assert.equal(await page.evaluate(`Boolean([...document.querySelectorAll('.pane-follows')].some((m) => m.textContent === 'after'))`), false, 'nothing lands while it is open');
    await page.evaluate(`document.getElementById('held').close()`);
    await until('it lands', () => page.evaluate<boolean>(`[...document.querySelectorAll('.pane-follows')].some((m) => m.textContent === 'after')`));
    const theirs = await panes();
    // Merge into, in ⋯: the chat's panes join the owner's tab, which comes into sight, and the chat's tab is gone.
    await page.evaluate(`document.querySelector('#tabs .tab:nth-child(2) [aria-label="This tab: whom it follows, pop it out"]').click()`);
    await wait(500);
    await page.evaluate(`[...document.querySelectorAll('.tab-menu [role="menuitem"]')].find((b) => b.textContent === 'Home').click()`);
    await until('merged', async () => (await tabs()) === 1 && (await panes()) === theirs + 1);
    // Its next show finds its panes there: no tab is opened for it.
    await show({ lens: { filter: { find: ['text Something'] } }, note: 'Still here' });
    await until('it landed in its own pane', () => page.evaluate<boolean>(`[...document.querySelectorAll('.pane-follows')].some((m) => m.title === 'Still here')`));
    assert.equal(await tabs(), 1);
    // The reader works in their own pane; the chat ends: its panes go, the owner's stays, and so does their tab.
    await press('#canvas > .pane:first-of-type .pane-canvas');
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run, reason: 'closed', cannot_tell_rest: true } });
    await until('its panes are gone', async () => (await panes()) === 1);
    assert.equal(await tabs(), 1);
    assert.equal(await page.evaluate(`document.querySelector('#tabs .tab').dataset.ended ?? null`), null, 'the owner’s tab is not struck');
  } finally {
    await page.close();
  }
});

test('in a browser, a chat has a tab once it shows something, out of sight; closed by hand or gone quiet it stays closed until its next show; it ends with the chat', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'work', title: 'Something shown' }] })).result.created as Record<string, string>;
  const agent = 'agent:claude-code/archipelago';
  const page = await open(`${base}/`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const strip = () => page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('.tab-name')].map((t) => t.textContent))`).then(JSON.parse).then(called);
  const until = async (what: string, ok: (names: string[]) => boolean) => {
    for (let n = 0; n < 60; n++) if (ok(await strip())) return;
    else await wait(250);
    assert.fail(`${what}: ${JSON.stringify(await strip())} ${page.logs().join(' ')}`);
  };
  try {
    await wait(2500);
    const before = await page.evaluate<string>('location.hash');
    const { run } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'tab-one', surface: 'claude-code', title: 'Tab one' } })).result;
    await wait(2500);
    assert.ok(!(await strip()).includes('Tab one'), 'a chat that has shown nothing has no tab');
    await call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made.a, run } });
    await until('its tab', (names) => names.includes('Tab one'));
    assert.equal(await page.evaluate<string>('location.hash'), before, 'the reader stays where they were');
    await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'tab-one', surface: 'claude-code' } });
    await call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made.a, run } });
    await wait(2500);
    assert.equal(await page.evaluate<string>('location.hash'), before, 'its shows go to its tab, not the one in sight');
    assert.equal((await strip()).filter((t) => t === 'Tab one').length, 1, 'taking it up again opens no second tab');
    // Closed by hand, it stays closed, a reload too, until the chat next shows something.
    await page.evaluate(`document.querySelector('#tabs .tab:nth-child(2) [aria-label="Close this tab"]').click()`);
    await until('closed', (names) => !names.includes('Tab one'));
    await page.evaluate('location.reload()');
    await wait(3500);
    assert.ok(!(await strip()).includes('Tab one'), 'a reload does not bring it back');
    await call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made.a, run } });
    await until('its show brings it back', (names) => names.includes('Tab one'));
    // Its agent says where its work stands: the chat goes on, waiting, and its tab goes until it shows something again.
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run, summary: 'Done for now', cannot_tell_rest: true } });
    await until('gone while it waits', (names) => !names.includes('Tab one'));
    await call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made.a, run } });
    await until('back with its show', (names) => names.includes('Tab one'));
    // The chat ends: its tab goes.
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run, reason: 'closed', cannot_tell_rest: true } });
    await until('gone with the chat', (names) => !names.includes('Tab one'));
  } finally {
    await page.close();
  }
});

test('in a browser, the Follows menu lists the chats open now, by title', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const agent = 'agent:claude-code/archipelago';
  const start = async (id: string, title: string) => (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: id, title } })).result;
  const ending = await start('will-end', 'Will end');
  await start('stays-quiet', 'Stays quiet');
  const page = await open(`${base}/`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const menu = () => page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('.tab-menu [role="menuitemradio"]')].map((b) => b.textContent))`).then(JSON.parse).then(called);
  const opened = async (ok: (names: string[]) => boolean) => {
    for (let n = 0; n < 40; n++) {
      await page.evaluate(`document.querySelector('[aria-label="This tab: whom it follows, pop it out"]').click()`);
      await wait(300);
      const names = await menu();
      await page.evaluate(`document.querySelector('.tab-menu').hidePopover()`);
      if (ok(names)) return names;
      await wait(200);
    }
    assert.fail(`the menu: ${JSON.stringify(await menu())} ${page.logs().join('\n')}`);
  };
  try {
    await wait(2500);
    await opened((names) => names.includes('Will end') && names.includes('Stays quiet'));
    await call('/agent/report', undefined, { actor: agent, action: 'session_end', params: { run: ending.run, reason: 'closed', cannot_tell_rest: true } });
    const names = await opened((list) => !list.includes('Will end'));
    assert.deepEqual(names, ['Nobody', 'Stays quiet'], 'an ended chat leaves it; Everyone is gone, every chat having a tab of its own');
  } finally {
    await page.close();
  }
});

test('in a browser, a show frames a web address in its pane, and says whether the owner is looking at that tab', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  // A build being made, on this machine: what a dev server serves.
  const build = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Build</title><p id="built">Built</p>'));
  await new Promise<void>((done) => build.listen(0, '127.0.0.1', done));
  const url = `http://localhost:${(build.address() as AddressInfo).port}/sketch`;
  const agent = 'agent:claude-code/archipelago';
  const { run } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'web-show', title: 'Web show' } })).result;
  const page = await open(`${base}/`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: string, ok: () => Promise<boolean>) => {
    for (let n = 0; n < 60; n++) if (await ok()) return;
    else await wait(250);
    assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const show = async (params: Record<string, unknown>) => (await call('/agent/report', undefined, { actor: agent, action: 'show', params: { ...params, run } })).result;
  const press = async (selector: string) => {
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  };
  try {
    await wait(3000);
    const first = await show({ url, note: 'The build' });
    assert.equal(first.sight.looking, false, 'its first show opens a tab of its own, out of sight');
    await until('the chat has a tab', () => page.evaluate<boolean>(`document.querySelectorAll('#tabs .tab').length === 2`));
    await press('#tabs .tab:nth-child(2) .tab-name');
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
    await press('#tabs .tab:nth-child(1) .tab-name');
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
