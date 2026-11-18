// The canvas is one pane (packs/panes/page/panes.js; the tabs went, decision e_mnuthcap): in a real browser (skipped
// where there is no Chrome) a show leaves it and the address the reader's, a change reaches it, the sheet takes its
// room, back and forward in the band step through the lenses, and a reload draws it again. A show may still name a
// pane (the step carries it); the page draws nothing apart for it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { PANE, heard, ready } from './agent-page.ts';
import { until as holds } from './wait.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, the canvas is one pane: a show never moves it, the log keeps it live, the sheet takes its room', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
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
    ops: [{ op: 'create', ref: 'g', type: 'lens', title: 'The second', props: { filter: { find: [`id ${made.b}`] }, walk: { over: [], steps: 0 } } }],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?find=id+${made.b}`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${await page.evaluate<string>('location.hash')} ${page.logs().join('\n')}`);
  };
  const show = (params: Record<string, unknown>) => call('/agent/report', undefined, { actor: 'robot', action: 'show', params }).then((r) => r.result);
  const panes = () => page.evaluate<number>(`document.querySelectorAll('${PANE}').length`);
  const draws = (words: string) => page.evaluate<boolean>(`document.querySelector('${PANE} svg')?.textContent.includes(${JSON.stringify(words)}) ?? false`);
  try {
    await ready(page);
    await until('the canvas draws the second', () => draws('Second step'));
    // No tabs: the bar holds no strip, the band back and forward.
    assert.equal(await page.evaluate<number>(`document.querySelectorAll('#tabs, [data-key^="tab:"]').length`), 0, 'no tabs');
    assert.equal(await page.evaluate<number>(`document.querySelectorAll('#query [aria-label="Back"], #query [aria-label="Forward"]').length`), 2, 'back and forward in the band');
    // A session's show of a lens leaves the canvas and the address the reader's (decision e_mnuthcap).
    const where = await page.evaluate<string>('location.hash');
    const shown = await show({ entity: views.g });
    assert.equal(shown.sight.looking, false, 'nothing brought into sight');
    await heard(page);
    assert.equal(await panes(), 1, 'one canvas');
    assert.equal(await page.evaluate<string>('location.hash'), where, 'the address stays the reader’s');
    // The canvas stays live: a rename reaches it from the log.
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.b, title: 'Second step, renamed' }] });
    await until('it follows the log', () => draws('Second step, renamed'));
    // The sheet takes its room from the canvas; shut, the canvas has the page again, at the lens it drew.
    await page.evaluate(`document.querySelector('${PANE} svg a[href="#/e/${made.b}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))`);
    await until('the canvas stops at the sheet', () => page.evaluate<boolean>(`document.body.dataset.sheet === 'open' && Math.abs(document.querySelector('${PANE} .pane-canvas').getBoundingClientRect().right - (innerWidth - document.getElementById('sheet').offsetWidth)) < 2`));
    await page.evaluate(`document.getElementById('sheet-close').click()`);
    await until('the canvas has the page again', () => page.evaluate<boolean>(`document.body.dataset.sheet !== 'open' && location.hash === ${JSON.stringify(where)}`));
    // An address as a show answers it, without its slash, opens what it names.
    await page.evaluate(`location.hash = '#v?find=id+${made.a}'`);
    await until('the lens it names', async () => (await page.evaluate<string>('location.hash')) === `#/v?find=id+${made.a}` && (await draws('First step')));
    // Back goes to the lens before.
    await page.evaluate(`document.querySelector('#query [aria-label="Back"]').click()`);
    await until('back to the second', async () => (await page.evaluate<string>('location.hash')) === where && (await draws('Second step, renamed')));
    // A reload draws it again as it was.
    await page.evaluate('location.reload()');
    await until('drawn again', async () => (await panes()) === 1 && (await draws('Second step, renamed')));
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
