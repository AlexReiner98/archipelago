// The island side bar and the canvas agree (task e_7jx9ccjb, the owner, 18 Nov 2026: serious): an island made after the
// page loaded is listed from the tail without a reload, and whatever the canvas draws (Home, an item's address, a show's
// list) is exactly what the bar marks on, a press there acting on that list.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import { until as holds } from './wait.ts';

const browser = chrome();

test('in a browser, the side bar lists a new island at once and marks what the canvas draws', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  await call('/api/workspace_set', undefined, { islands: true });
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'harbour', type: 'island', title: 'Harbour works', props: { pack: 'core' } },
      { op: 'create', ref: 'quarry', type: 'island', title: 'Quarry', props: { pack: 'core' } },
      { op: 'create', ref: 'pier', type: 'task', title: 'Rebuild the pier', props: { island: '{harbour}' } },
      { op: 'create', ref: 'stone', type: 'task', title: 'Cut the stone', props: { island: '{quarry}' } },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  /** The names the bar marks on (rows with the class `on`), sorted. */
  const marked = () => page.evaluate<string[]>(`[...document.querySelectorAll('#islands .isl-row.on .isl-name')].map((n) => n.textContent).sort()`);
  const listed = (name: string) => page.evaluate<boolean>(`[...document.querySelectorAll('#islands .isl-row .isl-name')].some((n) => n.textContent === ${JSON.stringify(name)})`);
  const draws = (words: string) => page.evaluate<boolean>(`document.querySelector('#canvas svg')?.textContent.includes(${JSON.stringify(words)}) ?? false`);
  const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
  try {
    // Home: Harbour works alone on, kept in this browser (no person with sign-in off).
    await page.evaluate(`(localStorage.setItem('pelago-islands', ${JSON.stringify(JSON.stringify([made.harbour]))}), location.reload())`);
    await until('Home draws Harbour works', () => draws('Rebuild the pier'));
    await until('the bar marks Harbour works on', async () => same(await marked(), ['Harbour works']));

    // An island made after the page loaded (and its tail has answered once) is listed from the tail, without a reload.
    await new Promise((r) => setTimeout(r, 3000));
    const reloads = await page.evaluate<number>(`(window.loads = (window.loads ?? 0) + 1)`);
    const later = (await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'mill', type: 'island', title: 'Windmill rebuilt', props: { pack: 'core' } },
        { op: 'create', ref: 'sail', type: 'task', title: 'Stitch the sails', props: { island: '{mill}' } },
      ],
    })).result.created as Record<string, string>;
    await until('the new island listed', () => listed('Windmill rebuilt'));
    assert.equal(await page.evaluate<number>(`window.loads`), reloads, 'without a reload');

    // An item's address draws its island: the bar marks that one, not the person's list.
    await page.evaluate(`location.hash = '#/e/${later.sail}'`);
    await until('the canvas draws the windmill', () => draws('Stitch the sails'));
    await until('the bar marks the windmill alone', async () => same(await marked(), ['Windmill rebuilt']));
    assert.equal(await draws('Rebuild the pier'), false, 'Harbour works is not drawn there');
    assert.equal(await page.evaluate<string>(`document.querySelector('#islands .isl-head').textContent`), 'On · 1');

    // A press there acts on what is drawn: Quarry put on joins the windmill, and the canvas goes Home to draw both.
    await page.evaluate(`[...document.querySelectorAll('#islands .isl-row')].find((r) => r.querySelector('.isl-name').textContent === 'Quarry').querySelector('button.isl-name').click()`);
    await until('Home draws the windmill and Quarry', async () => (await draws('Stitch the sails')) && (await draws('Cut the stone')));
    await until('the bar marks both', async () => same(await marked(), ['Quarry', 'Windmill rebuilt']));
    assert.equal(await draws('Rebuild the pier'), false);

    // An agent's show of a list (islands= in the address) is marked as drawn too.
    await page.evaluate(`location.hash = '#/v?islands=${made.harbour}'`);
    await until('the show draws Harbour works', () => draws('Rebuild the pier'));
    await until('the bar marks Harbour works alone', async () => same(await marked(), ['Harbour works']));
  } finally {
    await page.close();
  }
});
