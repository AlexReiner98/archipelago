// Tabs at the top of the owner's page (ui/tab-bar.js, decisions e_mzer5m4t, e_q3amet26, e_ezb7s3a7, e_xjrpyysn): in a
// real browser (skipped where there is no Chrome), one session gets a pane of its own beside the reader's, several
// sessions of one agent each keep a tab named by the session,
// one showing just after another lands in the background and is marked, a press brings a tab into sight, a show while
// the reader is at work goes to a tab behind, and a tab pops out into a window of its own and docks back whole.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a show lands without a line at the foot: a note on its pane, a screen in a tab, a question waited for', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'a', type: 'work', title: 'Something shown' }] })).result.created as Record<string, string>;
  const agent = 'agent:claude-code/archipelago';
  const { run, name } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'no-line' } })).result;
  const page = await open(`${base}/`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: string, ok: () => Promise<boolean>) => {
    for (let n = 0; n < 60; n++) if (await ok()) return;
    else await wait(250);
    assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const show = (params: Record<string, unknown>) => call('/agent/report', undefined, { actor: agent, action: 'show', params: { ...params, run } });
  const tabs = () => page.evaluate<number>(`document.querySelectorAll('#tabs .tab').length`);
  try {
    await wait(3000);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('#followed, #follow'))`), false, 'no line, and nothing in the menu to turn it on');
    // The note is on the pane, in its mark's tooltip.
    await show({ entity: made.a, note: 'What the note says' });
    await until('its pane', () => page.evaluate<boolean>(`document.querySelectorAll('#canvas > .pane').length === 2`));
    assert.deepEqual(JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const m = [...document.querySelectorAll('#canvas > .pane')][1].querySelector('.pane-follows'); return [m.textContent, m.title]; })())`)), [name, 'What the note says']);
    // A page that is no canvas takes no pane of the reader's: a tab of its own, marked, and it is open there.
    await show({ screen: 'workspace' });
    await until('a tab of its own', async () => (await tabs()) === 2);
    assert.equal(await page.evaluate(`document.querySelectorAll('#canvas > .pane').length`), 2, 'the tab in sight stays as it was');
    assert.equal(await page.evaluate(`document.querySelector('#tabs .tab:nth-child(2)').dataset.unseen`), 'true');
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector('#tabs .tab:nth-child(2) .tab-name').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await until('the workspace is open in it', () => page.evaluate<boolean>(`location.hash.startsWith('#/workspace')`));
    // A question open over the page holds a show: it lands once the question is answered.
    await page.evaluate(`(() => { const d = document.createElement('dialog'); d.id = 'held'; document.body.append(d); d.showModal(); })()`);
    await show({ entity: made.a, pane: 'after' });
    await wait(3000);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.pane-follows')?.textContent === 'after')`), false, 'nothing lands while it is open');
    await page.evaluate(`document.getElementById('held').close()`);
    await until('it lands', () => page.evaluate<boolean>(`[...document.querySelectorAll('.pane-follows')].some((m) => m.textContent === 'after')`));
  } finally {
    await page.close();
  }
});

test('in a browser, several sessions each keep a tab, which pops out and docks back',{ skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: ['First', 'Second', 'Third'].map((t, n) => ({ op: 'create', ref: `i${n}`, type: 'work', title: `${t} step` })),
  })).result.created as Record<string, string>;
  const agent = 'agent:claude-code/archipelago';
  const sessions: { run: string; name: string }[] = [];
  for (const n of [0, 1, 2]) sessions.push((await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: `tabs-${n}` } })).result);
  const page = await open(`${base}/`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: string, ok: () => Promise<boolean>) => {
    for (let n = 0; n < 60; n++) if (await ok()) return;
    else await wait(250);
    assert.fail(`${what}: ${JSON.stringify(await strip())} ${page.logs().join('\n')}`);
  };
  const show = (n: number, item: string) => call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made[item], run: sessions[n].run } });
  /** The strip as the reader sees it: each tab's name, whether it is in sight, marked, or out in a window. */
  const strip = () => page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('#tabs .tab')].map((t) => [t.querySelector('.tab-name').textContent, t.getAttribute('aria-selected') === 'true', Boolean(t.dataset.unseen), t.classList.contains('tab-out')]))`).then(JSON.parse) as Promise<[string, boolean, boolean, boolean][]>;
  const press = async (selector: string, target?: string) => {
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, target);
  };
  const tabOf = (n: number) => `#tabs .tab:nth-child(${n})`;
  try {
    await wait(3000);
    // One session alone gets a pane of its own in the one tab there is, beside the reader's, whose address stays.
    await show(0, 'i0');
    await until('the first session is drawn', async () => page.evaluate(`document.querySelectorAll('#canvas > .pane').length === 2 && [...document.querySelectorAll('#canvas > .pane')][1].textContent.includes('First step')`));
    assert.equal((await strip()).length, 1);
    const reader = await page.evaluate<string>('location.hash');
    // The tab's own controls are on the strip, not in the query bar, which shows the lens.
    assert.equal(await page.evaluate(`Boolean(document.querySelector('#tabs [aria-label="New tab"]')) && !document.querySelector('#query .q-follows, #query [aria-label="New tab"]')`), true);
    // A second and a third, just after: each a tab of its own, in the background, marked.
    await show(1, 'i1');
    await until('the second keeps a tab', async () => (await strip()).length === 2);
    await show(2, 'i2');
    await until('the third keeps a tab', async () => (await strip()).length === 3);
    const names = (await strip()).map((t) => t[0]);
    assert.deepEqual(names.slice(1), [sessions[1].name, sessions[2].name], 'a session’s tab is named by the session');
    assert.deepEqual((await strip()).map((t) => [t[1], t[2]]), [[true, false], [false, true], [false, true]], 'the tab in sight stays; the others are marked');
    assert.equal(await page.evaluate(`location.hash`), reader);
    // Each session comes back to its own tab: no fourth.
    await show(1, 'i2');
    await wait(1500);
    assert.equal((await strip()).length, 3);
    // A press brings a tab into sight, where its session last showed.
    await press(`${tabOf(2)} .tab-name`);
    await until('the second session’s tab is in sight', async () => (await page.evaluate<string>(`location.hash`)).startsWith(`#/e/${made.i2}?`) && (await strip())[1][1]);
    // While the reader is at work in it, its session's next show goes to a tab behind.
    await press('#canvas');
    await show(1, 'i0');
    await until('a tab behind', async () => (await strip()).length === 4);
    assert.ok((await page.evaluate<string>(`location.hash`)).startsWith(`#/e/${made.i2}?`), 'the page the reader is in stays');
    assert.deepEqual((await strip())[3].slice(0, 3), [sessions[1].name, false, true]);
    // The tab in sight pops out into a window of its own, and docks back whole.
    await page.send('Target.setDiscoverTargets', { discover: true });
    await press(`${tabOf(2)} [aria-label="This tab: whom it follows, pop it out"]`);
    await press('.tab-menu [role="menuitem"]');
    await until('the tab is out', async () => (await strip()).some((t) => t[3]));
    assert.equal((await strip()).filter((t) => !t[3]).length, 3);
    const targets = (await page.send('Target.getTargets')).result.targetInfos as { targetId: string; type: string; url: string }[];
    const popped = targets.find((t) => t.type === 'page' && t.url.includes(`/e/${made.i2}`));
    assert.ok(popped, 'a window was opened on the tab’s canvas');
    const { sessionId } = (await page.send('Target.attachToTarget', { targetId: popped.targetId, flatten: true })).result;
    const inPopped = async (expression: string) => (await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result?.result?.value;
    for (let n = 0; n < 40 && !(await inPopped(`Boolean(document.querySelector('[aria-label="Dock back"]'))`)); n++) await wait(250);
    await inPopped(`document.querySelector('[aria-label="Dock back"]').click()`);
    await until('the tab docked back, in sight', async () => {
      const now = await strip();
      return now.length === 4 && !now.some((t) => t[3]) && now.some((t) => t[0] === sessions[1].name && t[1]);
    });
  } finally {
    await page.close();
  }
});
