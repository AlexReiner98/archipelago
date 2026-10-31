// The two tips over a mark, in a real browser under real mouse input (skipped where there is no Chrome): the page's tip
// never shows over a step while the drawing's answer is on its way (e_a5s2q4qs), a late answer leaves the step its own
// title, and a mark the drawing says nothing over still shows that title.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, the page tip waits for the drawing over a step', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'work', title: 'Tipped here' },
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
    for (const end = Date.now() + 20000; Date.now() < end; await wait(100)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const mouse = (x: number, y: number) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const step = `document.querySelector('#canvas svg a[href="#/e/${made.a}"]')`;
  const pageTip = `document.querySelector('.tip')`;
  const drawingTip = `document.querySelector('.drawing-tip')`;
  const up = (tip: string) => `Boolean(${tip}?.matches(':popover-open'))`;
  try {
    assert.ok(await until(`Boolean(${step}) && Boolean(document.querySelector('#canvas .lens-view')?.moves)`), `the step is drawn: ${page.logs().join('\n')}`);
    await wait(500);
    const at = await page.evaluate<[number, number]>(`(() => { const r = ${step}.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    const empty = await page.evaluate<[number, number]>(`(() => {
      const fr = document.querySelector('#canvas .lf-stage').getBoundingClientRect();
      for (let y = fr.top + 80; y < fr.bottom - 100; y += 17) for (let x = fr.left + 200; x < fr.right - 60; x += 23) {
        const e = document.elementFromPoint(x, y);
        if (e?.tagName.toLowerCase() === 'svg' || e?.classList.contains('lf-stage')) return [x, y];
      }
      return null;
    })()`);

    // Resting on the stage its title is up; moved onto the step, that tip must not follow there, not for one sample.
    await mouse(...empty);
    assert.ok(await until(up(pageTip)), 'the frame says what it says');
    await page.evaluate(`(() => {
      window.saidOver = [];
      const look = () => ${up(pageTip)} && ${step}.matches(':hover') && saidOver.push(${pageTip}.textContent);
      setInterval(look, 2);
      const frame = () => (look(), requestAnimationFrame(frame));
      frame();
    })()`);
    await mouse(...at);
    assert.ok(await until(up(drawingTip)), 'the drawing answers with its tip');
    await wait(100);
    assert.deepEqual(await page.evaluate(`saidOver`), [], 'the page tip said nothing over the step');
    assert.equal(await page.evaluate(up(pageTip)), false, 'and says nothing now');

    // The drawing's answer lands after the pointer has gone: the step keeps its title, and the frame does not speak for it.
    await mouse(...empty);
    assert.ok(await until(`!${up(drawingTip)} && ${up(pageTip)}`), 'off the step, the frame speaks again');
    await page.evaluate(`document.querySelector('#canvas .lens-view').drawingTip.show(${step}, document.createTextNode('late'))`);
    assert.equal(await page.evaluate(`Boolean(${step}.querySelector(':scope > title'))`), true, 'the title is left on the step');
    await mouse(...at);
    await mouse(at[0] + 2, at[1] + 1);
    assert.ok(await until(`!${up(pageTip)}`), 'over the step, the frame says nothing');

    // A mark a drawing is told of and says nothing over: its title waits for the answer, then shows. Its own, not a parent's.
    // The page's own copies of its modules, by the version it loads them at.
    const version = `new URL(document.querySelector('link[href^="/base.js"]').href).search`;
    await page.evaluate(`(async () => {
      const { toldOfEnter } = await import('/marks.js' + ${version});
      const el = document.createElement('button');
      el.id = 'silent';
      el.title = 'Said by its title';
      el.style = 'position: fixed; left: 300px; top: 300px; width: 80px; height: 40px; z-index: 99999';
      document.body.append(el);
      toldOfEnter.add(el);
    })()`);
    await mouse(340, 320);
    await until(`!${up(drawingTip)}`);
    await wait(100);
    assert.equal(await page.evaluate(up(pageTip)), false, 'it waits for the drawing');
    await page.evaluate(`import('/tip.js' + ${version}).then(({ answered }) => answered(document.getElementById('silent')))`);
    assert.equal(await page.evaluate(`${up(pageTip)} && ${pageTip}.textContent`), 'Said by its title');
  } finally {
    await page.close();
  }
});
