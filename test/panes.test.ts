// More than one canvas at once (ui/panes.js), every pane alike: an agent's show can name a pane of the owner's page, the
// step carrying it; in a real browser (skipped where there is no Chrome) a session's show opens a pane of its own beside
// the reader's, a change reaches every pane, the bar, find, back and the address follow the pane last touched, a reload
// draws every pane again, a click in any pane opens the item's page over it, and a pane's name dragged docks it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

test('a show names the pane it goes to, and the page is told it with the step', async () => {
  const { call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'work.task', title: 'Something to see' }] })).result.created as Record<string, string>;
  const page = { page: 'p1', on: true };
  await call('/api/tail', undefined, { page });
  await call('/agent/report', undefined, { actor: 'robot', action: 'show', params: { entity: made.t, pane: 'right' } });
  const steps = (await call('/api/tail', undefined, { page })).result.steps;
  assert.ok(steps.some((s: { kind: string; pane?: string }) => s.kind === 'show' && s.pane === 'right'));
  assert.match((await call('/agent/report', undefined, { actor: 'robot', action: 'show', params: { entity: made.t, pane: 'Not a pane!' } })).error ?? '', /pane/);
});

const browser = chrome();

test('in a browser, every pane is alike: its own lens, history and address, an agent beside the reader', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work.task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'work.task', title: 'Second step' },
      { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    ],
  })).result.created as Record<string, string>;
  const views = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'f', type: 'lens', title: 'The first', status: 'current', props: { filter: { ids: [made.a] }, walk: { over: [], steps: 0 } } },
      { op: 'create', ref: 'g', type: 'lens', title: 'The second', status: 'current', props: { filter: { ids: [made.b] }, walk: { over: [], steps: 0 } } },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: string, ok: () => Promise<boolean>) => {
    for (let n = 0; n < 60; n++) if (await ok()) return;
    else await wait(250);
    assert.fail(`${what}: ${JSON.stringify(await panes())} ${await page.evaluate<string>('location.hash')} ${page.logs().join('\n')}`);
  };
  const show = (params: Record<string, unknown>) => call('/agent/report', undefined, { actor: 'robot', action: 'show', params }).then((r) => r.result);
  /** The panes as the reader sees them, in order: each one's name, its left edge, whose it is, and whether it is in focus. */
  const panes = () =>
    page
      .evaluate<string>(`JSON.stringify([...document.querySelectorAll('#canvas > .pane')].map((p) => [p.querySelector('.pane-name').textContent, Math.round(p.getBoundingClientRect().left), p.querySelector('.pane-follows').textContent, p.classList.contains('pane-active')]))`)
      .then(JSON.parse) as Promise<[string, number, string, boolean][]>;
  /** Pane `n`'s element, in order. */
  const nth = (n: number) => `[...document.querySelectorAll('#canvas > .pane')][${n}]`;
  const draws = (n: number, words: string) => page.evaluate<boolean>(`${nth(n)}?.querySelector('svg')?.textContent.includes(${JSON.stringify(words)}) ?? false`);
  const press = async (n: number) => {
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = ${nth(n)}.querySelector('.pane-canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 20]; })())`));
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const find = (words: string) => page.evaluate(`(() => { const input = document.querySelector('#find input[type=search]'); input.value = ${JSON.stringify(words)}; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); document.getElementById('find').requestSubmit(); })()`);
  try {
    await wait(3000);
    // A session's show opens a pane of its own beside the reader's, which keeps what it drew and the address.
    await show({ entity: views.f });
    await until('a pane of its own draws the first', async () => (await panes()).length === 2 && (await draws(1, 'First step')));
    assert.deepEqual((await panes()).map((p) => [p[0], p[2], p[3]]), [['Home', '', true], ['The first', 'robot', false]], 'the reader keeps their pane and the bar; the new one says whose it is');
    assert.ok(['', '#/'].includes(await page.evaluate<string>('location.hash')), 'the address stays the reader’s');
    // A pane by a name of the session's own, beside it.
    await show({ entity: views.g, pane: 'second' });
    await until('the named pane draws the second', async () => (await panes()).length === 3 && (await draws(2, 'Second step')));
    // Every pane stays live: a rename reaches each from the log.
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.a, title: 'First step, renamed' }, { op: 'update', id: made.b, title: 'Second step, renamed' }] });
    await until('each pane follows the log', async () => (await draws(1, 'First step, renamed')) && (await draws(2, 'Second step, renamed')));
    // Its next show goes to its own pane again, which a side moves; alone keeps only that one.
    await show({ entity: views.f, pane: 'left' });
    await until('its pane moved to the left', async () => (await panes())[0]?.[0] === 'The first' && (await panes())[0][1] === 0);
    // Alone closes no pane of the reader's (e_e7yfp2yg): only the reader does, by hand.
    await show({ entity: views.f, pane: 'alone' });
    await wait(3000);
    assert.equal((await panes()).length, 3, 'the reader’s panes stay');
    for (const name of ['Home', 'The second']) await page.evaluate(`[...document.querySelectorAll('#canvas > .pane')].find((p) => p.querySelector('.pane-name').textContent === ${JSON.stringify(name)}).querySelector('[aria-label="Close this pane"]').click()`);
    await until('only its pane', async () => (await panes()).length === 1 && (await draws(0, 'First step, renamed')));
    assert.ok(await page.evaluate(`${nth(0)}.getBoundingClientRect().width > 1200`), 'the one pane has the page');

    // By hand: split, and each pane is its own. A press in the second makes it the one the bar, find and the address act on.
    await page.evaluate(`document.querySelector('#query [aria-label="Split"]').click()`);
    await until('two panes', async () => (await panes()).length === 2);
    await press(1);
    await until('the second is in focus', async () => (await panes())[1][3]);
    await until('the second draws what the first did', async () => (await draws(1, 'First step, renamed')));
    await find('Second');
    // Find sets the words of the second's lens and keeps the rest of it (e_e3k797d3): what it drew stays, what the words find joins it.
    await until('the second draws what find found', async () => (await draws(1, 'Second step, renamed')) && (await draws(1, 'First step, renamed')) && (await draws(0, 'First step, renamed')) && !(await draws(0, 'Second step')));
    assert.match(await page.evaluate<string>('location.hash'), /Second/, 'the address is the pane in focus’s');
    // ‹ in the bar, and the browser's own back, act on the pane in focus.
    await page.evaluate(`document.querySelector('#query [aria-label="Back"]').click()`);
    await until('back draws what the pane drew before', async () => (await draws(1, 'First step, renamed')) && !(await draws(1, 'Second step')));
    await find('Second');
    await until('found again', async () => (await draws(1, 'Second step, renamed')));
    await page.evaluate('history.back()');
    await until('the browser’s back draws what the pane drew before', async () => (await draws(1, 'First step, renamed')) && !(await draws(1, 'Second step')));
    await page.evaluate('history.forward()');
    await until('and forward again', async () => (await draws(1, 'Second step, renamed')));
    // A press in the first gives it the bar and the address, with nothing of the second's.
    await press(0);
    await until('the first is in focus', async () => (await panes())[0][3] && (await page.evaluate<boolean>(`document.getElementById('find-lens').textContent.includes('First step, renamed')`)));
    assert.doesNotMatch(await page.evaluate<string>('location.hash'), /Second/, 'the address is the first pane’s');
    // A reload draws every pane as it was, each with its own history.
    await page.evaluate('location.reload()');
    await until('both panes again', async () => (await panes()).length === 2 && (await draws(0, 'First step, renamed')) && (await draws(1, 'Second step, renamed')) && (await panes())[0][3]);
    await press(1);
    await until('the second keeps its history', () => page.evaluate<boolean>(`!document.querySelector('#query [aria-label="Back"]').disabled`));
    // A click on a node in either pane opens its page over it, that pane's lens as it was (e_jedng69e): the second
    // finds by its words, and the item clicked is not added to its ids.
    await page.evaluate(`${nth(1)}.querySelector('svg a[href="#/e/${made.b}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))`);
    await until('its page is open over the second', async () => (await page.evaluate<boolean>(`document.body.dataset.sheet === 'open' && location.hash.startsWith('#/e/${made.b}?') && location.hash.includes('text=Second') && !(new URLSearchParams(location.hash.split('?')[1]).get('ids') ?? '').includes('${made.b}')`)) && (await panes())[1][3]);
    await page.evaluate(`${nth(0)}.querySelector('svg a[href="#/e/${made.a}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))`);
    await until('its page is open over the first', async () => (await page.evaluate<boolean>(`location.hash.startsWith('#/e/${made.a}?') && !location.hash.includes('Second')`)) && (await panes())[0][3]);
    await page.evaluate(`document.getElementById('sheet-close').click()`);
    // Shut, and slid away: until then it covers the second pane's strip.
    await until('the sheet shut', () => page.evaluate<boolean>(`document.body.dataset.sheet !== 'open' && getComputedStyle(document.getElementById('sheet')).visibility === 'hidden'`));

    // A pane's name dragged to the left of the other docks it there, and × closes it; the strip has only ⠿ and ×.
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = ${nth(1)}.querySelector('.pane-name').getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; })())`));
    const mouse = (type: string, at: number[]) => page.send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await mouse('mousePressed', [x, y]);
    for (let n = 1; n <= 8; n++) await mouse('mouseMoved', [x + ((30 - x) * n) / 8, y + ((450 - y) * n) / 8]);
    await mouse('mouseReleased', [30, 450]);
    await until('the second docked on the left', async () => (await draws(0, 'Second step, renamed')) && (await panes())[0][1] === 0 && (await panes())[1][1] > 500);
    await page.evaluate(`${nth(0)}.querySelector('[aria-label="Close this pane"]').click()`);
    await until('closed by hand', async () => (await panes()).length === 1 && (await draws(0, 'First step, renamed')));
    await page.evaluate(`document.querySelector('#query [aria-label="Split"]').click()`);
    await until('a pane once more', async () => (await panes()).length === 2);
    assert.deepEqual(await page.evaluate(`[...${nth(1)}.querySelectorAll('.pane-bar [aria-label]')].map((b) => b.getAttribute('aria-label'))`), ['Move this pane', 'Move this pane to a new tab', 'Close this pane'], 'every pane has the same controls');
    // A pane of the reader's own splits too: Split opens a second of it, not the pane it finds drawing the same.
    await page.evaluate(`${nth(0)}.querySelector('[aria-label="Close this pane"]').click()`);
    await until('the reader’s pane alone', async () => (await panes()).length === 1);
    await press(0);
    await page.evaluate(`document.querySelector('#query [aria-label="Split"]').click()`);
    await until('the reader’s pane split', async () => (await panes()).length === 2);
  } finally {
    await page.close();
  }
});
