// What the browser tests of saved canvases share (test/saved-canvases*.test.ts): a map with a task, a step of it, a
// view kept about it and another task, with a type of page that can bring a view in; a page on it; and one pass of saving a canvas from the bar at a width.
// The views kept are listed in the bar's switcher, not on Home (the owner, 10 Nov 2026).

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { open } from './browser.ts';
import { serve } from './serve.ts';

/** The map, and a page in a Chrome of its own opened on the task and its parts. */
export async function savedCanvasPage() {
  const { base, call } = await serve('off', undefined, undefined, [join(import.meta.dirname, 'fixtures', 'packs')]);
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'task', title: 'Saved here' },
      { op: 'create', ref: 'a', type: 'task', title: 'A step of it' },
      { op: 'link', type: 'part_of', from: 'a', to: 'p' },
      { op: 'create', ref: 'q', type: 'task', title: 'Another task' },
    ],
  })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'v', type: 'lens', title: 'A view of it', props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 2 } } }, { op: 'link', type: 'about', from: 'v', to: made.p }] });
  const page = await open(`${base}/#/v?find=id+${made.p}&over=part_of&steps=1`);
  const drawn = (id: string) => `Boolean(document.querySelector('#canvas svg a[href="#/e/${id}"]'))`;
  const canvasUp = () => page.evaluate<string | null>(`new URLSearchParams(location.hash.split('?')[1] ?? '').get('canvas')`);
  const picked = `document.querySelector('#query .q-pick')?.dataset.title`;
  const canvases = async () => (await call('/api/search', undefined, { type: 'lens', limit: 50 })).result as { id: string; title: string; props: Record<string, any> }[];
  const width = (w: number) => page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  /** A canvas of the task and its parts, kept as the bar keeps one saved at `at` px: what a pass before this one left. */
  const keptBefore = (at: number) => call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'c', type: 'lens', title: `Saved at ${at}`, props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 1 } } }] });

  /** The rows of the switcher's panel, opened from the bar if it is not open; none while the bar is still being drawn. */
  const panelRows = `(() => { const p = document.querySelector('.view-panel'); const b = document.querySelector('#query .q-pick'); if (!p || (!p.matches(':popover-open') && !b)) return []; if (!p.matches(':popover-open')) b.click(); return [...p.querySelectorAll('.view-row')]; })()`;

  /** At `w` px: a canvas saved from the bar and listed in its switcher, one line each. */
  async function savePass(w: number) {
    await width(w);
    const name = `Saved at ${w}`;
    await page.go(`${base}/#/v?find=id+${made.p}&over=part_of&steps=1`);
    assert.ok(await page.until(drawn(made.a)), `drawn: ${page.logs().join('\n')}`);
    assert.ok(await page.until(`document.querySelector('#query .q-pick')?.title.startsWith('Not saved')`), 'the bar says what is up is not saved');

    // Saved from the bar: a name asked in the page.
    await page.evaluate(`document.querySelector('#query .q-save[aria-label="Save this view"]').click()`);
    assert.ok(await page.until(`Boolean(document.querySelector('dialog.ask[open] textarea'))`), 'a name is asked');
    await page.evaluate(`(() => { const d = document.querySelector('dialog.ask'); d.querySelector('textarea').value = ${JSON.stringify(name)}; d.querySelector('button[value="ok"]').click(); })()`);
    assert.ok(await page.until(`${picked} === ${JSON.stringify(name)}`), `the bar names it: ${await page.evaluate(picked)}`);
    const saved = (await canvases()).find((c) => c.title === name)!;
    assert.ok(saved, 'kept on the map');
    assert.deepEqual([saved.props.filter.find, saved.props.walk], [[`id ${made.p}`], { over: ['part_of'], steps: 1 }], 'its lens: the filter, the walk');
    assert.equal(await canvasUp(), saved.id, 'its id in the address');

    // The switcher: one line each, opening in one click.
    // Waited for by its name: a canvas saved before is listed already.
    assert.ok(await page.until(`${panelRows}.some((r) => r.dataset.title === ${JSON.stringify(name)})`), 'listed in the switcher');
    const rows = await page.evaluate<{ title: string; tall: number; line: number; wide: boolean }[]>(
      `${panelRows}.map((r) => ({ title: r.dataset.title, tall: r.getBoundingClientRect().height, line: parseFloat(getComputedStyle(r).lineHeight) || 20, wide: r.scrollWidth > r.clientWidth + 1 }))`,
    );
    await page.evaluate(`document.querySelector('.view-panel').hidePopover()`);
    for (const r of rows) assert.ok(r.tall < 3 * r.line && !r.wide, `one line at ${w}: ${JSON.stringify(r)}`);
    assert.ok(rows.some((r) => r.title === name));
  }

  return { base, call, made, page, drawn, canvasUp, picked, width, keptBefore, savePass, panelRows };
}
