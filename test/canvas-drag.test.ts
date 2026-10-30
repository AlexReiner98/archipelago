// A step moved by hand on the canvas, in a real browser (skipped where there is no Chrome): dragged, it is written to
// the places stream in one call before the next thing the page does (here, going to another canvas), never as a change
// to the map, and the canvas opened again draws it where it was put.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

for (const shape of ['', 'plane', 'rows']) test(`in a browser, a step dragged on the canvas${shape && ` in the form ${shape}`} is kept in the places stream and drawn there again`, { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'project', title: 'Moved here' },
      { op: 'create', ref: 'a', type: 'task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'task', title: 'Second step' },
      { op: 'link', type: 'part_of', from: 'a', to: 'p' },
      { op: 'link', type: 'part_of', from: 'b', to: 'p' },
      { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    ],
  })).result.created as Record<string, string>;
  const events = async () => (await call('/api/events', undefined, { limit: 100 })).result.length as number;
  const form = shape && `&shape=${shape}`, canvas = `${made.p}${shape && `@${shape}`}`, page = await open(`${base}/#/v?from=${made.p}${form}`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(200)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const step = `document.querySelector('#canvas svg a[href="#/e/${made.a}"]')`;
  // Where the step's middle is in the picture's own units, as the page measures it to drop it (ui/drag.js).
  const middle = `(() => { const el = ${step}; const b = el.getBBox(); const m = el.transform?.baseVal?.consolidate?.()?.matrix; return [b.x + b.width / 2 + (m?.e ?? 0), b.y + b.height / 2 + (m?.f ?? 0)]; })()`;
  try {
    assert.ok(await until(`Boolean(${step})`), `the step is drawn: ${page.logs().join('\n')}`);
    await wait(800);
    const before = await page.evaluate<[number, number]>(middle);
    const was = await events();
    const { x, y, scale } = await page.evaluate<{ x: number; y: number; scale: number }>(`(() => { const r = ${step}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale: ${step}.ownerSVGElement.getScreenCTM().a }; })()`);
    const mouse = (type: string, at: [number, number], buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await mouse('mouseMoved', [x, y], 0);
    await mouse('mousePressed', [x, y]);
    for (let k = 1; k <= 10; k++) (await mouse('mouseMoved', [x + 16 * k, y + 9 * k]), await wait(30));
    await mouse('mouseReleased', [x + 160, y + 90], 0);
    await wait(300);
    const dropped = await page.evaluate<[number, number]>(middle);
    assert.ok(Math.abs(dropped[0] - before[0] - 160 / scale) < 3 && Math.abs(dropped[1] - before[1] - 90 / scale) < 3, `moved with the pointer: ${before} to ${dropped}`);
    assert.equal((await call('/api/places', undefined, { canvas })).result[made.a], undefined, 'kept on the page until the next thing it does');

    // Another canvas drawn: the batch is written first, in one call of its own.
    await page.evaluate(`location.hash = '#/'`);
    let placed: Record<string, [number, number]> = {};
    for (const end = Date.now() + 10000; Date.now() < end && !placed[made.a]; await wait(200)) placed = (await call('/api/places', undefined, { canvas })).result;
    assert.ok(placed[made.a], 'written to the places stream');
    assert.ok(Math.abs(placed[made.a][0] - dropped[0]) <= 1 && Math.abs(placed[made.a][1] - dropped[1]) <= 1, `where it was let go: ${placed[made.a]} and ${dropped}`);
    assert.equal(placed[made.b], undefined, 'only what was moved');
    assert.equal(await events(), was, 'no change to the map: a place is not a fact about the work');

    // The canvas opened again, in a page of its own: the step is drawn where it was put.
    await page.go(`${base}/#/v?from=${made.p}${form}`);
    assert.ok(await until(`Boolean(${step})`), 'drawn again');
    assert.ok(await until(`(() => { const m = ${middle}; return Math.abs(m[0] - ${placed[made.a][0]}) < 2 && Math.abs(m[1] - ${placed[made.a][1]}) < 2; })()`), `drawn where it was put: ${await page.evaluate(middle)} for ${placed[made.a]}`);
  } finally {
    await page.close();
  }
});
