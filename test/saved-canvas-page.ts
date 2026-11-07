// What the browser tests of saved canvases share (test/saved-canvases*.test.ts): a map with a project, a step of it, a
// view kept about it and another project; a page on it; and one pass of saving a canvas from the bar at a width.

import assert from 'node:assert/strict';
import { open } from './browser.ts';
import { serve } from './serve.ts';

/** The map, and a page in a Chrome of its own opened on the project and its parts. */
export async function savedCanvasPage() {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'project', title: 'Saved here' },
      { op: 'create', ref: 'a', type: 'task', title: 'A step of it' },
      { op: 'link', type: 'part_of', from: 'a', to: 'p' },
      { op: 'create', ref: 'q', type: 'project', title: 'Another project' },
    ],
  })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'v', type: 'lens', title: 'A view of it', props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 2 } } }, { op: 'link', type: 'about', from: 'v', to: made.p }] });
  const page = await open(`${base}/#/v?find=id+${made.p}&over=part_of&steps=1`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(150)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const drawn = (id: string) => `Boolean(document.querySelector('#canvas svg a[href="#/e/${id}"]'))`;
  const canvasUp = () => page.evaluate<string | null>(`new URLSearchParams(location.hash.split('?')[1] ?? '').get('canvas')`);
  const picked = `document.querySelector('#query .q-pick')?.dataset.title`;
  const canvases = async () => (await call('/api/search', undefined, { type: 'lens', limit: 50 })).result as { id: string; title: string; props: Record<string, any> }[];
  const width = (w: number) => page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  /** A canvas of the project and its parts, kept as the bar keeps one saved at `at` px: what a pass before this one left. */
  const keptBefore = (at: number) => call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'c', type: 'lens', title: `Saved at ${at}`, props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 1 } } }] });

  /** At `w` px: a canvas saved from the bar and listed on Home one line each. */
  async function savePass(w: number) {
    await width(w);
    const name = `Saved at ${w}`;
    await page.go(`${base}/#/v?find=id+${made.p}&over=part_of&steps=1`);
    assert.ok(await until(drawn(made.a)), `drawn: ${page.logs().join('\n')}`);
    assert.ok(await until(`document.querySelector('#query .q-pick')?.title.startsWith('Not saved')`), 'the bar says what is up is not saved');

    // Saved from the bar: a name asked in the page.
    await page.evaluate(`document.querySelector('#query .q-save[aria-label="Save this view"]').click()`);
    assert.ok(await until(`Boolean(document.querySelector('dialog.ask[open] textarea'))`), 'a name is asked');
    await page.evaluate(`(() => { const d = document.querySelector('dialog.ask'); d.querySelector('textarea').value = ${JSON.stringify(name)}; d.querySelector('button[value="ok"]').click(); })()`);
    assert.ok(await until(`${picked} === ${JSON.stringify(name)}`), `the bar names it: ${await page.evaluate(picked)}`);
    const saved = (await canvases()).find((c) => c.title === name)!;
    assert.ok(saved, 'kept on the map');
    assert.deepEqual([saved.props.filter.find, saved.props.walk], [[`id ${made.p}`], { over: ['part_of'], steps: 1 }], 'its lens: the filter, the walk');
    assert.equal(await canvasUp(), saved.id, 'its id in the address');

    // Home: one line each, opening in one click.
    await page.evaluate(`location.hash = '#/you'`);
    // Waited for by its name: a canvas saved before is listed already.
    assert.ok(await until(`[...document.querySelectorAll('.canvases > .rows > li a')].some((a) => a.textContent === ${JSON.stringify(name)})`), 'listed on Home');
    const rows = await page.evaluate<{ title: string; tall: number; line: number; wide: boolean }[]>(
      `[...document.querySelectorAll('.canvases > .rows > li')].map((li) => ({ title: li.querySelector('a').textContent, tall: li.getBoundingClientRect().height, line: parseFloat(getComputedStyle(li).lineHeight) || 20, wide: li.scrollWidth > li.clientWidth + 1 }))`,
    );
    for (const r of rows) assert.ok(r.tall < 3 * r.line && !r.wide, `one line at ${w}: ${JSON.stringify(r)}`);
    assert.ok(rows.some((r) => r.title === name));
  }

  return { base, call, made, page, until, drawn, canvasUp, picked, width, keptBefore, savePass };
}
