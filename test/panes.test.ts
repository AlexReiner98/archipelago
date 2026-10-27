// More than one canvas at once (ui/panes.js): an agent's show can name a pane of the owner's page, the step carrying
// it; in a real browser (skipped where there is no Chrome) a show opens a canvas in a pane beside the main one, its
// look is of that pane, a change reaches both panes, a pane's name dragged to the other side docks it there, and alone
// leaves the main canvas by itself.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

test('a show names the pane it goes to, and the page is told it with the step', async () => {
  const { call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'work.task', title: 'Something to see' }] })).result.created as Record<string, string>;
  const page = { page: 'p1', on: true, muted: [] };
  await call('/api/tail', undefined, { page });
  await call('/agent/report', undefined, { actor: 'robot', action: 'show', params: { entity: made.t, pane: 'right' } });
  const steps = (await call('/api/tail', undefined, { page })).result.steps;
  assert.ok(steps.some((s: { kind: string; pane?: string }) => s.kind === 'show' && s.pane === 'right'));
  assert.match((await call('/agent/report', undefined, { actor: 'robot', action: 'show', params: { entity: made.t, pane: 'nowhere' } })).error ?? '', /pane/);
});

const browser = chrome();

test('in a browser, a show opens a canvas in a pane beside the main one, both kept current, docked by a drag', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
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
    assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const show = (params: Record<string, unknown>) => call('/agent/report', undefined, { actor: 'robot', action: 'show', params }).then((r) => r.result);
  const panes = () => page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('#panes .pane')].map((p) => [p.querySelector('.pane-name').textContent, Math.round(p.getBoundingClientRect().left)]))`).then(JSON.parse);
  try {
    await page.evaluate(`localStorage.setItem('pelago-follow', 'on')`);
    await wait(3000);
    await show({ entity: views.f });
    await until('the main canvas draws the first', () => page.evaluate(`document.querySelector('#canvas svg')?.textContent.includes('First step') ?? false`));
    // A show into a pane: the second beside the first, and its look is of that pane alone.
    const looked = await show({ entity: views.g, pane: 'right', look: true, wait_seconds: 30 });
    assert.match(looked.data ?? '', /^iVBORw0KGgo/, `a picture of the pane: ${JSON.stringify({ ...looked, data: undefined })}`);
    assert.ok(looked.width < 700, `the pane's width, not the page's: ${looked.width}`);
    await until('the pane draws the second', () => page.evaluate(`document.querySelector('#panes svg')?.textContent.includes('Second step') ?? false`));
    assert.deepEqual((await panes()).map((p: [string, number]) => p[0]), ['The second']);
    assert.ok(await page.evaluate(`document.querySelector('#canvas svg').textContent.includes('First step') && location.hash.includes('${views.f}')`), 'the main canvas still draws the first');
    // Both stay live: a rename reaches each pane from the log.
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.a, title: 'First step, renamed' }, { op: 'update', id: made.b, title: 'Second step, renamed' }] });
    await until('the main canvas follows the log', () => page.evaluate(`document.querySelector('#canvas svg')?.textContent.includes('First step, renamed') ?? false`));
    await until('the pane follows the log', () => page.evaluate(`document.querySelector('#panes svg')?.textContent.includes('Second step, renamed') ?? false`));
    // An agent moves it to the other side, then leaves the main canvas alone.
    await show({ entity: views.g, pane: 'left' });
    await until('the pane moved to the left', async () => (await panes())[0]?.[1] === 0);
    await show({ entity: views.f, pane: 'alone' });
    await until('the pane closed', async () => (await panes()).length === 0);
    assert.ok(await page.evaluate(`document.getElementById('canvas').getBoundingClientRect().width > 1200`), 'the main canvas has the page');
    // By hand: the pane's name dragged to the left of the main canvas docks it there, and × closes it.
    await show({ entity: views.g, pane: 'right' });
    await until('the pane is back on the right', async () => (await panes())[0]?.[1] > 500);
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector('.pane-name').getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; })())`));
    const mouse = (type: string, at: number[]) => page.send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await mouse('mousePressed', [x, y]);
    for (let n = 1; n <= 8; n++) await mouse('mouseMoved', [x + ((30 - x) * n) / 8, y + ((450 - y) * n) / 8]);
    await mouse('mouseReleased', [30, 450]);
    await until('the pane docked on the left', async () => (await panes())[0]?.[1] === 0);
    assert.ok(await page.evaluate(`document.getElementById('canvas').getBoundingClientRect().left > 500`), 'the main canvas is on the right');
    await page.evaluate(`document.querySelector('.pane [aria-label="Close this pane"]').click()`);
    await until('the pane closed by hand', async () => (await panes()).length === 0);
  } finally {
    page.close();
  }
});
