// Zooming the canvas, in a real browser (skipped where there is no Chrome): what is out of sight is not drawn, and
// what comes back into sight is drawn again, also after the picture changed while it was out of sight (a step dragged,
// a wire drawn). Measured while it was not drawn, a mark has no box, and was kept out of sight wherever the reader went
// (e_wsexbmgf).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, what comes into sight is drawn, though the picture changed while it was out of sight', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  // A long order: its first step at the top of the picture, its last far below.
  const titles = Array.from({ length: 10 }, (_, k) => `Step ${k + 1} of the order`);
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'work', title: 'Zoomed here' },
      ...titles.map((title, k) => ({ op: 'create', ref: `s${k}`, type: 'work', title })),
      ...titles.map((_, k) => ({ op: 'link', type: 'part_of', from: `s${k}`, to: 'p' })),
      ...titles.slice(1).map((_, k) => ({ op: 'link', type: 'depends_on', from: `s${k + 1}`, to: `s${k}` })),
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?from=${made.p}`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(200)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const step = (id: string) => `document.querySelector('#canvas svg a[href="#/e/${id}"]')`;
  const moves = `document.querySelector('#canvas .lens-view').moves`;
  const frames = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`;
  const [first, last] = [made.s0, made.s9];
  // A step's middle in the picture's units, measured while it is drawn.
  const middle = (id: string) => `(() => { const b = ${step(id)}.getBBox(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`;
  const drawn = (id: string) => `${step(id)}.getAttribute('display') !== 'none'`;
  try {
    assert.ok(await until(`Boolean(${step(last)}) && Boolean(${moves})`), `the order is drawn: ${page.logs().join('\n')}`);
    await wait(500);
    await page.evaluate(`(async () => { ${moves}.fit(); await ${frames}; })()`);
    const [top, bottom] = [await page.evaluate<[number, number]>(middle(first)), await page.evaluate<[number, number]>(middle(last))];
    assert.ok(bottom[1] - top[1] > 400, `the last step is far below the first: ${top} and ${bottom}`);

    // Zoomed in on the first step: the last is out of sight, and not drawn.
    await page.evaluate(`(async () => { const m = ${moves}; m.restore({ ...m.state(), s: 3 }); m.show(${top[0]}, ${top[1]}); await ${frames}; })()`);
    assert.equal(await page.evaluate(drawn(last)), false, 'out of sight, the last step is not drawn');
    // The picture changes while it is out of sight, as a step dragged or a wire drawn changes it.
    await page.evaluate(`(async () => { const p = document.querySelector('#canvas svg path'); p.setAttribute('d', p.getAttribute('d')); await ${frames}; })()`);
    // Moved to the last step, still zoomed in: it is drawn, and so is everything in sight.
    await page.evaluate(`(async () => { ${moves}.show(${bottom[0]}, ${bottom[1]}); await ${frames}; })()`);
    assert.equal(await page.evaluate(drawn(last)), true, 'brought into sight, the last step is drawn');
    assert.equal(await page.evaluate(drawn(first)), false, 'and the first, now out of sight, is not');
    const missing = await page.evaluate<number>(`(() => {
      const v = ${moves}.inView(), svg = document.querySelector('#canvas .lf-stage svg');
      const els = [...svg.children].flatMap((el) => (el.tagName === 'g' && !el.attributes.length ? [...el.children] : [el]));
      return els.filter((el) => el.getAttribute('display') === 'none').filter((el) => {
        el.removeAttribute('display');
        const b = el.getBBox();
        el.setAttribute('display', 'none');
        return b.x + b.width >= v.x && b.x <= v.x + v.width && b.y + b.height >= v.y && b.y <= v.y + v.height;
      }).length;
    })()`);
    assert.equal(missing, 0, 'no mark in sight is left undrawn');
  } finally {
    await page.close();
  }
});
