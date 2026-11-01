// Zooming the canvas with fingers, in a real browser with a touch screen (skipped where there is no Chrome): a phone has
// no wheel, so two fingers zoom about the point between them, and the page shows no buttons for it. A pinch that began on
// a step leaves that step where it stood; one finger moves the picture. Headless Chrome makes no click of a tap, even on a plain button, so a tap is not tried here.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser with a touch screen, two fingers zoom the canvas', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const titles = Array.from({ length: 6 }, (_, k) => `Step ${k + 1} of the order`);
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'work', title: 'Pinched here' },
      ...titles.map((title, k) => ({ op: 'create', ref: `s${k}`, type: 'work', title })),
      ...titles.map((_, k) => ({ op: 'link', type: 'part_of', from: `s${k}`, to: 'p' })),
      ...titles.slice(1).map((_, k) => ({ op: 'link', type: 'depends_on', from: `s${k + 1}`, to: `s${k}` })),
    ],
  })).result.created as Record<string, string>;
  const page = await open('about:blank');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(200)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const moves = `document.querySelector('#canvas .lens-view').moves`;
  const frames = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`;
  const touch = (type: string, points: [number, number][]) => page.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
    await page.go(`${base}/#/v?from=${made.p}`);
    assert.ok(await until(`Boolean(document.querySelector('#canvas svg a[href="#/e/${made.s5}"]')) && Boolean(${moves})`), `the order is drawn: ${page.logs().join('\n')}`);
    await wait(500);

    assert.equal(await page.evaluate(`[...document.querySelectorAll('#canvas button[title="Zoom in"]')].some((b) => b.getClientRects().length)`), false, 'the canvas keeps its zoom buttons hidden');

    // Two fingers on a step, drawn apart: bigger, the point between them still under them, the step not moved.
    const step = `document.querySelector('#canvas svg a[href="#/e/${made.s1}"]')`;
    const [x, y] = await page.evaluate<[number, number]>(`(() => { const r = ${step}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    const before = await page.evaluate<{ s: number; x: number; y: number }>(`${moves}.state()`);
    const shift = await page.evaluate<string | null>(`${step}.getAttribute('transform')`);
    const stage = await page.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('#canvas .lf-stage').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('#canvas .lf-legend'))`), false, 'the key does not cover a phone\'s picture');

    // One finger on a step moves the picture, not the step.
    await touch('touchStart', [[x, y]]);
    for (const by of [10, 20, 30]) (await touch('touchMove', [[x, y + by]]), await wait(30));
    await touch('touchEnd', []);
    await page.evaluate(frames);
    assert.ok((await page.evaluate<{ y: number }>(`${moves}.state()`)).y < before.y, 'one finger moved the picture');
    assert.equal(await page.evaluate(`${step}.getAttribute('transform')`), shift, 'and left the step where it stood');
    await page.evaluate(`(async () => { ${moves}.restore(${JSON.stringify(before)}); await ${frames}; })()`);

    await touch('touchStart', [[x - 10, y]]);
    await touch('touchStart', [[x - 10, y], [x + 10, y]]);
    for (const by of [20, 30, 40]) (await touch('touchMove', [[x - by, y], [x + by, y]]), await wait(30));
    await touch('touchEnd', []);
    await page.evaluate(frames);
    const after = await page.evaluate<{ s: number; x: number; y: number }>(`${moves}.state()`);
    assert.ok(Math.abs(after.s / before.s - 4) < 0.5, `four times the fingers' distance is four times the scale: ${before.s} to ${after.s}`);
    const world = (v: typeof after) => v.x + (x - stage.x) / v.s;
    assert.ok(Math.abs(world(after) - world(before)) < 5, `the point between them stays under them: ${world(before)} and ${world(after)}`);
    assert.equal(await page.evaluate(`${step}.getAttribute('transform')`), shift, 'the step a finger began on did not move');
    assert.equal(await page.evaluate(`location.hash.includes('/e/')`), false, 'and did not open');

    const gone = page.logs().filter((l) => /error/i.test(l) && !/favicon/.test(l));
    assert.deepEqual(gone, [], 'the page said nothing went wrong');
  } finally {
    await page.close();
  }
});
