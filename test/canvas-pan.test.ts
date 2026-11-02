// A pan in a real browser under real mouse input (skipped where there is no Chrome): the plane goes with the pointer's
// own place, nothing locks the pointer or draws a cursor of its own, and a click stays a click.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a pan follows the pointer natively, and a click stays a click', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'work', title: 'Panned here' },
      { op: 'create', ref: 'a', type: 'work', title: 'First step' },
      { op: 'create', ref: 'b', type: 'work', title: 'Second step' },
      { op: 'link', type: 'part_of', from: 'a', to: 'p' },
      { op: 'link', type: 'part_of', from: 'b', to: 'p' },
      { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?from=${made.p}`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(50)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const mouse = (type: string, x: number, y: number, buttons = 0) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const stage = `document.querySelector('#canvas .lf-stage')`;
  const moves = `document.querySelector('#canvas .lens-view').moves`;
  const view = () => page.evaluate<{ x: number; y: number; s: number }>(`${moves}.state()`);
  const frames = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`;
  const step = `document.querySelector('#canvas svg a[href="#/e/${made.a}"]')`;
  const free = `!document.pointerLockElement && !${stage}.classList.contains('moving')`;
  try {
    assert.ok(await until(`Boolean(${step}) && Boolean(${moves})`), `the steps are drawn: ${page.logs().join('\n')}`);
    await wait(300);
    const [x, y] = await page.evaluate<[number, number]>(`(() => {
      const fr = ${stage}.getBoundingClientRect();
      for (let y = fr.top + 80; y < fr.bottom - 100; y += 17) for (let x = fr.left + 200; x < fr.right - 200; x += 23) {
        const e = document.elementFromPoint(x, y);
        if (e?.tagName.toLowerCase() === 'svg' || e?.classList.contains('lf-stage')) return [x, y];
      }
      return null;
    })()`);
    const press = async () => {
      await mouse('mouseMoved', x, y);
      await mouse('mousePressed', x, y, 1);
      await mouse('mouseMoved', x + 20, y, 1);
    };

    // A press and a release with no drag: a click, and the plane stays.
    await page.evaluate(`window.asked = 0; Element.prototype.requestPointerLock = function () { asked++; }`);
    const still = await view();
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, 1);
    await mouse('mouseReleased', x, y);
    assert.deepEqual(await view(), still, 'a click moves nothing');

    // A drag: the plane goes with the pointer, by its own place, and nothing locks it.
    await press();
    const was = await view();
    await mouse('mouseMoved', x + 80, y + 30, 1);
    await page.evaluate(frames);
    const now = await view();
    assert.ok(Math.abs((was.x - now.x) * now.s - 60) < 1 && Math.abs((was.y - now.y) * now.s - 30) < 1, `the plane follows the pointer: ${JSON.stringify([was, now])}`);
    assert.equal(await page.evaluate(`asked`), 0, 'no lock is asked for');

    // Let go: nothing left behind, and the release clicks nothing under it.
    await page.evaluate(`window.clicked = 0; ${stage}.parentElement.addEventListener('click', () => clicked++)`);
    await mouse('mouseReleased', x + 80, y + 30);
    assert.ok(await until(free), 'let go, the pan is over');
    await wait(50);
    assert.equal(await page.evaluate(`clicked`), 0, 'and its release is no click on what is under it');
    assert.deepEqual(page.logs().filter((l) => /exceptionDetails/.test(l)), [], 'and nothing is left unhandled');
  } finally {
    await page.close();
  }
});
