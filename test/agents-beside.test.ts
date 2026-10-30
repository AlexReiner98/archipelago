// Agents beside the reader, in a real browser (skipped where there is no Chrome): with two sessions at work while the
// reader works in a pane, an agent never moves the pane the reader is in. A change moves nothing; a show lands in a pane
// of its session's own beside the reader's, or in a tab of its own out of sight, marked; and it lands whether or not
// the page follows agents (the owner, 29 Oct 2026, e_e7yfp2yg, e_jk63uduv). An address as a show answers it, without
// its slash, opens what it names.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, agents at work never move the reader’s pane; a show lands in a pane of its own', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work.task', title: 'Reader’s step' },
      { op: 'create', ref: 'b', type: 'work.task', title: 'Agent’s step' },
      { op: 'create', ref: 'c', type: 'work.task', title: 'Other agent’s step' },
    ],
  })).result.created as Record<string, string>;
  const views = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'f', type: 'lens', title: 'The agent’s view', status: 'current', props: { filter: { find: [`id ${made.b}`] }, walk: { over: [], steps: 0 } } },
      { op: 'create', ref: 'g', type: 'lens', title: 'The other’s view', status: 'current', props: { filter: { find: [`id ${made.c}`] }, walk: { over: [], steps: 0 } } },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?find=id+${made.a}`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(150)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const show = (actor: string, params: Record<string, unknown>) => call('/agent/report', undefined, { actor, action: 'show', params }).then((r) => r.result);
  const change = (actor: string, ops: object[]) => call('/agent/change', undefined, { actor, reason: 'test', ops });
  /** The panes of the tab in sight: each one's name, and whether it is the one the bar acts on. */
  const panes = `JSON.stringify([...document.querySelectorAll('#canvas > .pane')].map((p) => [p.querySelector('.pane-name').textContent, p.classList.contains('pane-active')]))`;
  const readers = `(() => { const p = document.querySelector('#canvas > .pane.pane-active'); return Boolean(p?.querySelector('svg a[href="#/e/${made.a}"]')) && !p.querySelector('svg a[href="#/e/${made.b}"]') && location.hash.includes('find=id+${made.a}'); })()`;
  try {
    assert.ok(await until(`Boolean(document.querySelector('#canvas .pane-canvas svg a[href="#/e/${made.a}"]'))`), `the reader's canvas is drawn: ${page.logs().join('\n')}`);
    // The reader works in their pane, following agents off.
    await page.evaluate(`(localStorage.setItem('pelago-follow', 'off'), document.querySelector('#follow input').checked = false)`);
    const [x, y] = JSON.parse(await page.evaluate<string>(`JSON.stringify((() => { const r = document.querySelector('#canvas .pane-canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 20]; })())`));
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await wait(2500);
    // Changes, from two agents, move nothing.
    await change('robot', [{ op: 'update', id: made.b, title: 'Agent’s step, renamed' }]);
    await change('robot', [{ op: 'create', type: 'work.task', title: 'Something new' }]);
    await change('other', [{ op: 'update', id: made.c, title: 'Other agent’s step, renamed' }]);
    await wait(5000);
    assert.equal(JSON.parse(await page.evaluate<string>(panes)).length, 1, 'no pane opened for a change');
    assert.ok(await page.evaluate(readers), `the reader's pane as they left it: ${await page.evaluate('location.hash')}`);
    // A show lands, following off, in a pane of its own beside the reader's, which stays the one the bar acts on.
    const shown = await show('robot', { entity: views.f, note: 'test' });
    assert.ok(shown.pages.following >= 1, `the page takes shows: ${JSON.stringify(shown.pages)}`);
    assert.ok(await until(`(([r, a]) => r?.[1] === true && a?.[0] === 'The agent’s view' && a[1] === false)(JSON.parse(${panes}))`), `a pane of its own beside the reader's: ${await page.evaluate(panes)}`);
    assert.ok(await page.evaluate(readers), 'the reader’s pane is still theirs');
    // Its next show goes to that pane again; the reader's stays.
    await show('robot', { entity: made.b });
    await wait(3000);
    assert.equal(JSON.parse(await page.evaluate<string>(panes)).length, 2, 'its own pane again, not another');
    assert.ok(await page.evaluate(readers), 'the reader’s pane is still theirs');
    // A second session at work: a tab of its own, out of sight and marked; the tab in sight stays.
    const front = await page.evaluate<string>(`document.querySelector('#tabs .tab[aria-selected="true"]').dataset.tab`);
    await show('other', { entity: views.g });
    assert.ok(await until(`document.querySelectorAll('#tabs .tab').length === 2`), `the other's tab: ${await page.evaluate(`document.getElementById('tabs').textContent`)}`);
    assert.equal(await page.evaluate<string>(`document.querySelector('#tabs .tab[aria-selected="true"]').dataset.tab`), front, 'the tab in sight stays');
    assert.ok(await page.evaluate<boolean>(`Boolean(document.querySelector('#tabs .tab[data-unseen="true"]'))`), 'the other tab is marked');
    assert.ok(await page.evaluate(readers), 'the reader’s pane is still theirs');
    // An address as a show answers it, without its slash, opens what it names.
    await page.evaluate(`location.hash = '#e/${made.c}'`);
    assert.ok(await until(`location.hash.startsWith('#/e/${made.c}') && document.body.dataset.sheet === 'open' && document.querySelector('#sheet h1, #sheet .page-head')?.textContent.includes('Other agent’s step')`), `the item's page: ${await page.evaluate('location.hash')}`);
    await page.evaluate(`location.hash = '#v?find=id+${made.b}'`);
    assert.ok(await until(`location.hash === '#/v?find=id+${made.b}' && document.body.dataset.sheet !== 'open'`), `the lens it names: ${await page.evaluate('location.hash')}`);
  } finally {
    await page.close();
  }
});
