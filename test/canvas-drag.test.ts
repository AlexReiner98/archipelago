// A step moved by hand on a saved view, in a real browser (skipped where there is no Chrome): dragged, it stays where it
// was put on that drawing, its wires as they were on the last frame of the drag, and the map changing under it keeps it
// there; never a change to the map, and nothing kept. The view opened again is drawn from its query alone, the same as
// before the drag (the owner, 3 Nov 2026: a view is its query and its layout, and Home wore down under kept places).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

for (const shape of ['']) test(`in a browser, a step dragged on the canvas${shape && ` in the form ${shape}`} stays there until the view is drawn anew`, { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
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
  const view = { op: 'create', ref: 'v', type: 'lens', title: 'Moved on this view', props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of', 'depends_on'], steps: 1 } } };
  made.v = (await call('/api/change', undefined, { reason: 'test', ops: [view] })).result.created.v;
  const events = async () => (await call('/api/events', undefined, { limit: 100 })).result.length as number;
  const form = shape && `&shape=${shape}`, address = `${base}/#/v?canvas=${made.v}${form}`, page = await open(address);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(200)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const step = `document.querySelector('#canvas svg a[href="#/e/${made.a}"]')`;
  // Where the step's middle is in the picture's own units, as the page measures it to drop it (ui/drag.js).
  const wires = `[...document.querySelectorAll('#canvas svg path.lf-wire, #canvas svg path.lf-tie')].map((p) => p.getAttribute('d'))`;
  const middle = `(() => { const el = ${step}; const b = el.getBBox(); const m = el.transform?.baseVal?.consolidate?.()?.matrix; return [b.x + b.width / 2 + (m?.e ?? 0), b.y + b.height / 2 + (m?.f ?? 0)]; })()`;
  const near = (at: number[]) => `(() => { const m = ${middle}; return Math.abs(m[0] - ${at[0]}) < 2 && Math.abs(m[1] - ${at[1]}) < 2; })()`;
  try {
    assert.ok(await until(`Boolean(${step})`), `the step is drawn: ${page.logs().join('\n')}`);
    await wait(800);
    const before = await page.evaluate<[number, number]>(middle);
    const laidOut = await page.evaluate<string[]>(wires);
    const was = await events();
    const { x, y, scale } = await page.evaluate<{ x: number; y: number; scale: number }>(`(() => { const r = ${step}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale: ${step}.ownerSVGElement.getScreenCTM().a }; })()`);
    const mouse = (type: string, at: [number, number], buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await mouse('mouseMoved', [x, y], 0);
    await mouse('mousePressed', [x, y]);
    for (let k = 1; k <= 10; k++) (await mouse('mouseMoved', [x + 16 * k, y + 9 * k]), await wait(30));
    await wait(200);
    const lastFrame = await page.evaluate<string[]>(wires);
    await mouse('mouseReleased', [x + 160, y + 90], 0);
    await wait(300);
    assert.deepEqual(await page.evaluate<string[]>(wires), lastFrame, 'let go, every wire is as it was on the last frame');
    const dropped = await page.evaluate<[number, number]>(middle);
    assert.ok(Math.abs(dropped[0] - before[0] - 160 / scale) < 3 && Math.abs(dropped[1] - before[1] - 90 / scale) < 3, `moved with the pointer: ${before} to ${dropped}`);
    assert.equal(await events(), was, 'no change to the map: a place is not a fact about the work');

    // The map changing under it: drawn again from the facts, the step where it was put.
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.b, title: 'Second step, renamed' }] });
    assert.ok(await until(`[...document.querySelectorAll('#canvas svg a')].some((a) => a.textContent.includes('renamed'))`), 'the change is drawn');
    assert.ok(await until(near(dropped)), `still where it was put: ${await page.evaluate(middle)} for ${dropped}`);
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.b, title: 'Second step' }] });

    // Another canvas, then the view again: nothing was kept, and it is drawn as its layout draws it.
    await page.evaluate(`location.hash = '#/'`);
    await wait(500);
    await page.go(address);
    assert.ok(await until(`Boolean(${step})`), 'drawn again');
    assert.ok(await until(near(before)), `laid out as before the drag: ${await page.evaluate(middle)} for ${before}`);
    assert.equal((await page.evaluate<string[]>(wires)).length, laidOut.length, 'its wires as the layout drew them');
  } finally {
    await page.close();
  }
});
