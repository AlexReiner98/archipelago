// A pan past the pane's edge, in a real browser under real mouse input (skipped where there is no Chrome): the pointer
// is locked once a drag has really started and a drawn cursor comes round at the frame's edges (e_w9h9t5wr); a click
// stays a click, a lock lost mid-press ends the pan, and where the lock is refused the pan goes on as it always did.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a pan locks the pointer and wraps its cursor, and without the lock it still pans', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
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
  const locked = `document.pointerLockElement === ${stage}`;
  const cursor = `document.querySelector('.pan-cursor')`;
  const view = () => page.evaluate<{ x: number; y: number; s: number }>(`${moves}.state()`);
  const frames = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`;
  const step = `document.querySelector('#canvas svg a[href="#/e/${made.a}"]')`;
  const free = `!(${locked}) && !${cursor} && !${stage}.classList.contains('moving')`;
  try {
    assert.ok(await until(`Boolean(${step}) && Boolean(${moves})`), `the steps are drawn: ${page.logs().join('\n')}`);
    await wait(300);
    const [left, top, width, height] = await page.evaluate<number[]>(`(() => { const r = ${stage}.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
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

    // Chrome locks only for a window that holds the focus, which a person's press gives it.
    await page.send('Page.bringToFront');
    // A press and a release with no drag: no lock is asked for.
    await page.evaluate(`window.asked = 0; window.ask = Element.prototype.requestPointerLock; Element.prototype.requestPointerLock = function () { asked++; return ask.call(this); }`);
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, 1);
    await mouse('mouseReleased', x, y);
    assert.equal(await page.evaluate(`asked`), 0, 'a click locks nothing');

    // A drag: locked, a cursor drawn, and the plane goes with the hand.
    await press();
    assert.ok(await until(locked), 'the pan locks the pointer');
    assert.ok(await until(`Boolean(${cursor}?.matches(':popover-open'))`), 'and draws its cursor');
    const was = await view();
    await mouse('mouseMoved', x + 60, y + 30, 1);
    await page.evaluate(frames);
    const now = await view();
    assert.ok(now.x < was.x && now.y < was.y, `the plane follows the hand: ${JSON.stringify([was, now])}`);

    // Round the frame's edge, more than its width: the drawn cursor stays inside it, and the plane goes on.
    for (let n = 2; n < 8; n++) await mouse('mouseMoved', x + 300 * n, y + 30, 1);
    await page.evaluate(frames);
    const round = await page.evaluate<[number, number]>(`[parseFloat(${cursor}.style.left), parseFloat(${cursor}.style.top)]`);
    assert.ok(round[0] >= left && round[0] < left + width && round[1] >= top && round[1] < top + height, `the cursor comes round: ${round} in ${[left, top, width, height]}`);

    // Let go: nothing left behind.
    await mouse('mouseReleased', x, y);
    assert.ok(await until(free), 'let go, the lock and the cursor are gone');

    // The lock lost mid-press, as Esc loses it: the pan is over, and the release that follows clicks nothing.
    await wait(100);
    await press();
    assert.ok(await until(`${locked} && Boolean(${cursor})`), 'locked again');
    await page.evaluate(`document.exitPointerLock()`);
    assert.ok(await until(free), 'a lost lock ends the pan');
    const held = await view();
    await mouse('mouseMoved', x + 90, y, 1);
    await page.evaluate(frames);
    assert.deepEqual(await view(), held, 'the plane no longer follows the hand');
    await page.evaluate(`window.clicked = 0; ${stage}.parentElement.addEventListener('click', () => clicked++)`);
    await mouse('mouseReleased', x + 90, y);
    await wait(50);
    assert.equal(await page.evaluate(`clicked`), 0, 'and its release is no click on what is under it');

    // Refused, and not there at all: the pan is the one it always was, by the pointer's own place.
    for (const [why, stub] of [['refused', `() => Promise.reject(new DOMException('no', 'NotSupportedError'))`], ['throwing', `() => { throw new Error('no'); }`], ['not there', `undefined`]] as const) {
      await page.evaluate(`Element.prototype.requestPointerLock = ${stub}`);
      const from = await view();
      await press();
      await mouse('mouseMoved', x + 50, y, 1);
      await page.evaluate(frames);
      const to = await view();
      assert.ok(Math.abs((from.x - to.x) * to.s - 50) < 1, `${why}: the plane moved with the pointer: ${JSON.stringify([from, to])}`);
      await mouse('mouseReleased', x + 50, y);
      assert.equal(await page.evaluate(free), true, `${why}: nothing is left behind`);
      await wait(50);
    }
    assert.deepEqual(page.logs().filter((l) => /exceptionDetails/.test(l)), [], 'and nothing is left unhandled');
  } finally {
    await page.close();
  }
});
