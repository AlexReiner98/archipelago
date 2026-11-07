// Saved canvases opened and switched to (task e_uq77ps44), in a real browser at 560 px (skipped where there is no
// Chrome): one listed on Home opens in one click and is named in the bar, the bar switches between them, a view kept
// about an item is folded on Home and opened from there, and a view a document brings in is in neither list. Saving
// one from the bar is test/saved-canvases.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome } from './browser.ts';
import { savedCanvasPage } from './saved-canvas-page.ts';

const browser = chrome();

test('in a browser, a saved canvas is opened from Home and switched to from the bar; a view about an item is folded, one a document brings in is in neither list', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call, made, page, until, drawn, canvasUp, picked, width, keptBefore } = await savedCanvasPage();
  try {
    // As the canvases saved from the bar left the page: narrow, with one saved at 1280 px.
    await width(560);
    await keptBefore(1280);

    // An agent's canvas of another project; switched between from the bar.
    const other = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'c', type: 'lens', title: 'The other one', props: { filter: { find: [`id ${made.q}`] }, walk: { over: [], steps: 0 } } }] })).result.created.c as string;
    await page.go(`${base}/#/v?find=id+${made.q}`);
    await page.go(`${base}/#/you`);
    assert.ok(await until(`[...document.querySelectorAll('.canvases a')].some((a) => a.textContent === 'The other one')`), 'the new one is listed');
    await page.evaluate(`[...document.querySelectorAll('.canvases a')].find((a) => a.textContent === 'The other one').click()`);
    assert.ok(await until(drawn(made.q)), 'opened in one click: its lens drawn');
    assert.equal(await canvasUp(), other);
    assert.ok(await until(`${picked} === 'The other one'`), 'named in the bar');
    // As a chip, or in the folded line when the bar is narrow (560 px, as set above).
    assert.ok(await until(`[...document.querySelectorAll('#find .q-id, #find .q-more')].some((c) => (c.textContent + c.title).includes('Another project'))`), 'its lens in the bar');
    await page.evaluate(`(() => { const s = document.querySelector('#query .q-pick'); s.value = [...s.options].find((o) => o.textContent === 'Saved at 1280').value; s.dispatchEvent(new Event('change')); })()`);
    assert.ok(await until(drawn(made.a)), 'switched from the bar');
    assert.ok(await until(`${picked} === 'Saved at 1280'`));

    // A view kept about an item: folded on Home under the views of items, and opened from there.
    await page.go(`${base}/#/you`);
    assert.ok(await until(`Boolean(document.querySelector('.canvases .old-views'))`), 'the views of items are folded');
    assert.ok(!(await page.evaluate<boolean>(`[...document.querySelectorAll('.canvases > .rows a')].some((a) => a.textContent === 'A view of it')`)), 'not among the workspace’s own');
    await page.evaluate(`(() => { const ds = [...document.querySelectorAll('.canvases .old-views')]; ds.forEach((d) => (d.open = true)); ds.flatMap((d) => [...d.querySelectorAll('a')]).find((a) => a.textContent === 'A view of it').click(); })()`);
    assert.ok(await until(`${picked} === 'A view of it'`), `opened as a canvas: ${page.logs().join(' | ')}`);
    assert.ok(await until(drawn(made.a)));

    // A view a document brings in is a part of that page: in neither list, and named in the bar only while it is up.
    const held = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'v', type: 'lens', title: 'A page’s picture', props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 1 } } }, { op: 'link', type: 'about', from: 'v', to: made.p }] })).result.created.v as string;
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'd', type: 'document', title: 'A page', body: `Words.\n\n${held}` }] });
    await page.go(`${base}/#/you`);
    assert.ok(await until(`Boolean(document.querySelector('.canvases .old-views'))`));
    const listed = `[...document.querySelectorAll('.canvases a'), ...document.querySelectorAll('#query .q-pick option')].map((a) => a.textContent)`;
    assert.ok(!(await page.evaluate<string[]>(listed)).includes('A page’s picture'), 'not on Home');
    await page.go(`${base}/#/v?canvas=${other}`);
    assert.ok(await until(`${picked} === 'The other one'`));
    assert.ok(!(await page.evaluate<string[]>(listed)).includes('A page’s picture'), 'not in the switch');
    await page.go(`${base}/#/v?canvas=${held}`);
    assert.ok(await until(`${picked} === 'A page’s picture'`), 'named while it is up');

    // A view made, then changed, after the page read the saved views opens as saved, not as new or changed since (bump e_4j6xvm82).
    const saved = `(() => { const b = [...document.querySelectorAll('#query .q-save')].find((x) => x.getAttribute('aria-label') === 'Save this view'); return b?.disabled === true && b.textContent === 'Save'; })()`;
    const late = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'l', type: 'lens', title: 'Made since', status: 'kept', props: { filter: { find: [`id ${made.q}`] }, walk: { over: ['part_of'], steps: 1 } } }] })).result.created.l as string;
    await page.go(`${base}/#/v?canvas=${late}`);
    assert.ok(await until(`${picked} === 'Made since'`), 'named in the bar');
    assert.ok(await until(saved), 'saved, as it was made');
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: late, props: { walk: { over: ['part_of'], steps: 2 } } }] });
    await page.go(`${base}/#/v?canvas=${other}`);
    await page.go(`${base}/#/v?canvas=${late}`);
    assert.ok(await until(`${picked} === 'Made since' && ${saved}`), 'saved, as it was changed');
  } finally {
    await page.close();
  }
});
