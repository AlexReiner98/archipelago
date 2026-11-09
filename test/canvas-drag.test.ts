// A step cannot be dragged, in a real browser (skipped where there is no Chrome): a press and move on it pans the
// canvas, the step where its layout put it in the picture, and nothing is written. A view is drawn from its query alone
// (the owner, 3 Nov 2026: Home wore down under places put by hand on other pictures).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, wait } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a step cannot be dragged: a press and move on it pans the canvas', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'aim', title: 'Moved here' },
      { op: 'create', ref: 'a', type: 'task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'task', title: 'Second step' },
      { op: 'link', type: 'part_of', from: 'a', to: 'p' },
      { op: 'link', type: 'part_of', from: 'b', to: 'p' },
      { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    ],
  })).result.created as Record<string, string>;
  const events = async () => (await call('/api/events', undefined, { limit: 100 })).result.length as number;
  const page = await open(`${base}/#/v?from=${made.p}&shape=flow`);
  const step = `document.querySelector('#canvas svg a[href="#/e/${made.a}"]')`;
  const wires = `[...document.querySelectorAll('#canvas svg path.lf-wire, #canvas svg path.lf-tie')].map((p) => p.getAttribute('d'))`;
  // Where the step's middle is in the picture's own units, and on the screen.
  const middle = `(() => { const el = ${step}; const b = el.getBBox(); const m = el.transform?.baseVal?.consolidate?.()?.matrix; return [b.x + b.width / 2 + (m?.e ?? 0), b.y + b.height / 2 + (m?.f ?? 0)]; })()`;
  const onScreen = `(() => { const r = ${step}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;
  try {
    assert.ok(await page.until(`Boolean(${step})`), `the step is drawn: ${page.logs().join('\n')}`);
    assert.ok(await page.still(middle), 'the picture stands still');
    const [before, laidOut, was, [x, y]] = [await page.evaluate<number[]>(middle), await page.evaluate<string[]>(wires), await events(), await page.evaluate<number[]>(onScreen)];
    const mouse = (type: string, at: number[], buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await mouse('mouseMoved', [x, y], 0);
    await mouse('mousePressed', [x, y]);
    // The pointer moves as a hand does, a step every few milliseconds: the gesture is the time it takes.
    for (let k = 1; k <= 10; k++) (await mouse('mouseMoved', [x + 16 * k, y + 9 * k]), await wait(30));
    await mouse('mouseReleased', [x + 160, y + 90], 0);
    assert.ok(await page.still(middle), 'let go, the picture stands still');
    assert.deepEqual(await page.evaluate<number[]>(middle), before, 'where its layout put it in the picture');
    assert.deepEqual(await page.evaluate<string[]>(wires), laidOut, 'every wire as it was drawn');
    const moved = await page.evaluate<number[]>(onScreen);
    assert.ok(Math.abs(moved[0] - x - 160) < 3 && Math.abs(moved[1] - y - 90) < 3, `the canvas panned with the pointer: ${[x, y]} to ${moved}`);
    assert.ok(!(await page.evaluate<boolean>(`location.hash.startsWith('#/e/')`)), 'a press that moves is not a click: no page opened');
    assert.equal(await events(), was, 'nothing written');
  } finally {
    await page.close();
  }
});
