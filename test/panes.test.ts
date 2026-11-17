// A tab is one canvas (the panes part, packs/panes/parts/index.js; the canvas packs/panes/page/panes.js; Alex, 17 Nov
// 2026: no split panes): in a real browser (skipped where there is no Chrome) a session's show opens a tab of its own,
// apart from the reader's, its next show draws in that same canvas, a change reaches it, the sheet takes its room, and
// a reload draws it again. A show may still name a pane (the step carries it); the page draws it in the one canvas.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { PANE, TAB, paneName, ready, tabAt } from './tab-page.ts';
import { until as holds } from './wait.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a tab is one canvas: an agent in a tab of its own, its shows drawn there', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
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
      { op: 'create', ref: 'f', type: 'lens', title: 'The first', props: { filter: { find: [`id ${made.a}`] }, walk: { over: [], steps: 0 } } },
      { op: 'create', ref: 'g', type: 'lens', title: 'The second', props: { filter: { find: [`id ${made.b}`] }, walk: { over: [], steps: 0 } } },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${JSON.stringify(await panes())} ${await page.evaluate<string>('location.hash')} ${page.logs().join('\n')}`);
  };
  const show = (params: Record<string, unknown>) => call('/agent/report', undefined, { actor: 'robot', action: 'show', params }).then((r) => r.result);
  /** The canvases drawn, each its name. */
  const panes = () => page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('${PANE}')].map((p) => ${paneName('p')}?.textContent ?? ''))`).then(JSON.parse) as Promise<string[]>;
  /** Pane `n`'s element, in order. */
  const nth = (n: number) => `[...document.querySelectorAll('${PANE}')][${n}]`;
  const draws = (n: number, words: string) => page.evaluate<boolean>(`${nth(n)}?.querySelector('svg')?.textContent.includes(${JSON.stringify(words)}) ?? false`);
  try {
    await ready(page);
    // A session's show opens a tab of its own, out of sight: the reader's canvas and the address stay theirs.
    await show({ entity: views.f });
    await until('a tab of its own', () => page.evaluate<boolean>(`document.querySelectorAll('${TAB}').length === 2`));
    assert.equal((await panes()).length, 1, 'the reader keeps their one canvas');
    assert.ok(['', '#/'].includes(await page.evaluate<string>('location.hash')), 'the address stays the reader’s');
    // Brought into sight, its tab draws what it showed; its next show draws in the same canvas, never beside it.
    await page.evaluate(`${tabAt(2)}.querySelector('[data-key^="front:"]').click()`);
    await until('its tab draws the first', async () => (await panes()).length === 1 && (await draws(0, 'First step')));
    await show({ entity: views.g, pane: 'second' });
    await until('the same canvas draws the second', async () => (await panes()).length === 1 && (await draws(0, 'Second step')));
    assert.equal(await page.evaluate<number>(`document.querySelectorAll('${TAB}').length`), 2, 'no tab more');
    // The canvas stays live: a rename reaches it from the log.
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.b, title: 'Second step, renamed' }] });
    await until('it follows the log', () => draws(0, 'Second step, renamed'));
    assert.ok(await page.evaluate(`(() => { const r = ${nth(0)}.getBoundingClientRect(), bar = document.getElementById('islands')?.getBoundingClientRect().right ?? 0; return Math.abs(r.left - bar) < 2 && Math.abs(r.right - innerWidth) < 2; })()`), 'the one canvas has the page beside the islands bar');
    // The sheet takes its room from the canvas, so whatever it draws stands beside the sheet; shut, it has the page again.
    await page.evaluate(`${nth(0)}.querySelector('svg a[href="#/e/${made.b}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))`);
    await until('the canvas stops at the sheet', () => page.evaluate<boolean>(`document.body.dataset.sheet === 'open' && Math.abs(${nth(0)}.querySelector('.pane-canvas').getBoundingClientRect().right - (innerWidth - document.getElementById('sheet').offsetWidth)) < 2`));
    await page.evaluate(`document.getElementById('sheet-close').click()`);
    await until('the canvas has the page again', () => page.evaluate<boolean>(`document.body.dataset.sheet !== 'open' && (() => { const r = ${nth(0)}.getBoundingClientRect(), bar = document.getElementById('islands')?.getBoundingClientRect().right ?? 0; return Math.abs(r.left - bar) < 2 && Math.abs(r.right - innerWidth) < 2; })()`));
    // A tab has no ⋯ and no split: its name and × alone.
    assert.equal(await page.evaluate<number>(`document.querySelectorAll('#tabs details.pm-menu, #query [aria-label="Split"]').length`), 0);
    // A reload draws it again as it was.
    await page.evaluate('location.reload()');
    await until('drawn again', async () => (await panes()).length === 1 && (await draws(0, 'Second step, renamed')));
  } finally {
    await page.close();
  }
});

// Last: the steps a show leaves are kept in this process for a page that opens within minutes (e_d8djfzmk), and the
// browser test's page would land this one.
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
