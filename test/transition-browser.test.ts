// The transition engine in a real browser (skipped where there is no Chrome): a canvas drawn again as the map changes
// under it plays what changed (ui/transition.js). A step added fades in and its wire is drawn in, a step taken away
// fades where it stood, a step that stays moves from where it was by a transform; with less motion asked for it cuts.
// Only transform, opacity and a wire's dash are animated.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a scene drawn again moves its marks by key', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const change = async (ops: unknown[]) => (await call('/api/change', undefined, { reason: 'test', ops })).result;
  const made = (await change([
    { op: 'create', ref: 'p', type: 'task', title: 'Moving here' },
    { op: 'create', ref: 'a', type: 'task', title: 'First step' },
    { op: 'create', ref: 'b', type: 'task', title: 'Second step' },
    { op: 'create', ref: 'c', type: 'task', title: 'Third step' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
    { op: 'link', type: 'part_of', from: 'c', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
  ])).created as Record<string, string>;
  const page = await open(`${base}/#/v?from=${made.p}`);
  const step = (id: string) => `document.querySelector('#canvas svg a[href="#/e/${id}"]')`;
  // Every animation the page makes is written down: what it moves, and on what.
  const listen = () => page.evaluate(`(() => {
    window.played = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const on = this.closest('a[href]')?.getAttribute('href') ?? this.getAttribute('class') ?? this.tagName;
      window.played.push({ on, tag: this.tagName, props: [...new Set(frames.flatMap((f) => Object.keys(f)))], kept: Boolean(this.closest('[aria-hidden=true]')) });
      return animate.call(this, frames, options);
    };
    return true;
  })()`);
  const played = () => page.evaluate<{ on: string; tag: string; props: string[]; kept: boolean }[]>('window.played');
  const said = () => page.evaluate<string>(`document.querySelector('#canvas [data-transition]')?.dataset.transition ?? ''`);
  try {
    assert.ok(await page.until(`Boolean(${step(made.a)}) && Boolean(${step(made.c)})`), `the steps are drawn: ${page.logs().join('\n')}`);
    assert.ok(await page.still(), 'the first drawing has played');
    await listen();

    // ---- A step added: it fades in after the rest, and the wire to it is drawn in.
    const added = (await change([{ op: 'create', ref: 'd', type: 'task', title: 'Fourth step' }, { op: 'link', type: 'part_of', from: 'd', to: made.p }, { op: 'link', type: 'depends_on', from: 'd', to: made.b }])).created.d as string;
    assert.ok(await page.until(`Boolean(${step(added)})`), 'the new step is drawn');
    assert.ok(await page.until(`window.played.length > 0`, 5000), `something played: ${await said()}`);
    assert.ok(await page.still(), 'it has played');
    let now = await played();
    assert.equal(await said(), 'played');
    assert.ok(now.some((p) => p.on === `#/e/${added}` && p.props.includes('opacity')), `the new step fades in: ${JSON.stringify(now)}`);
    assert.ok(now.some((p) => p.props.includes('strokeDashoffset')), `its wire is drawn in: ${JSON.stringify(now)}`);
    for (const p of now) assert.deepEqual(p.props.filter((k) => !['opacity', 'transform', 'strokeDasharray', 'strokeDashoffset', 'offset', 'easing', 'composite'].includes(k)), [], `only transform and opacity move: ${JSON.stringify(p)}`);

    // ---- A step that stays and moves: its place on the screen changes, and it moves there by a transform.
    await listen();
    const was = await page.evaluate<number[]>(`(() => { const r = ${step(made.c)}.getBoundingClientRect(); return [r.x, r.y]; })()`);
    await change([{ op: 'link', type: 'depends_on', from: made.c, to: added }]);
    const plan = () => page.evaluate<any>(`document.querySelector('#canvas [data-transition]')?.transitionPlan ?? null`);
    assert.ok(await page.until(`window.played.length > 0 || document.querySelector('#canvas [data-transition]')?.dataset.transition === 'many'`, 8000), `something played: ${await said()}`);
    // The flow may lay out again more than a few steps: then it cuts, and that is what it should do.
    const cut = (await said()) === 'many', moved = await plan();
    if (cut) assert.ok(moved.move.length > 6, `cut only past a few movers: ${JSON.stringify(moved)}`);
    assert.ok(await page.still(), 'it has played');
    now = await played();
    const is = await page.evaluate<number[]>(`(() => { const r = ${step(made.c)}.getBoundingClientRect(); return [r.x, r.y]; })()`);
    // It moved on its own (by a transform of its own), or with the frame (the picture's, as one).
    const own = !cut && moved.move.some((m: { key: string }) => m.key === `s:${made.c}`);
    if (own) assert.ok(now.some((p) => p.on === `#/e/${made.c}` && p.props.includes('transform')), `the step moved from where it was: ${JSON.stringify([was, is, now])}`);
    else if (!cut && moved.frame) assert.ok(now.some((p) => p.tag === 'svg' && p.props.includes('transform')), `the frame moved as one: ${JSON.stringify(now)}`);
    // Nothing is left moved once it has played.
    assert.equal(await page.evaluate(`document.getAnimations().filter((a) => a.playState === 'running').length`), 0);

    // ---- A step taken away: it fades out where it stood, kept on the page out of the reader's reach, then gone.
    await listen();
    await change([{ op: 'archive', id: made.a }]);
    assert.ok(await page.until(`!document.querySelector('#canvas svg a[href="#/e/${made.a}"]:not([aria-hidden=true] *)') || window.played.length > 0`, 8000));
    assert.ok(await page.until(`window.played.some((p) => p.kept)`, 5000), `the step that left fades where it stood: ${JSON.stringify(await played())} ${await said()} ${await page.evaluate(`JSON.stringify(document.querySelector('#canvas [data-transition]').transitionPlan)`)} ${page.logs().slice(-5).join(" | ")}`);
    assert.ok(await page.still(), 'it has faded');
    assert.equal(await page.evaluate(`Boolean(${step(made.a)})`), false, 'and is gone once it has faded');

    // ---- Less motion asked for: a change is cut, nothing played.
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await listen();
    await change([{ op: 'update', id: made.c, title: 'Third step, renamed' }]);
    assert.ok(await page.until(`${step(made.c)}?.textContent.includes('renamed')`, 8000), 'drawn again');
    await page.until(`document.querySelector('#canvas [data-transition]')?.dataset.transition === 'reduced'`, 5000);
    assert.equal(await said(), 'reduced');
    assert.deepEqual(await played(), []);
  } finally {
    await page.close();
  }
});
