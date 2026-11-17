// An edit that only narrows changes the picture on screen at once (task e_ws9e2acq), in a real browser (skipped where
// there is no Chrome): what left the answer fades out of the picture shown, with its wires, at once after the
// edit and before the drawing has laid out the new answer; then what stayed glides to where that layout puts it, and
// the picture it settles on is the one the answer draws on a page opened fresh.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AT_ONCE, chrome, open, pageModule } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a narrowing edit takes what left out of the picture at once, and settles on the answer\'s own', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const ops: any[] = [{ op: 'create', ref: 'site', type: 'aim', title: 'Site works' }];
  for (const [n, type] of ['task', 'task', 'task', 'task', 'question', 'question', 'question'].entries()) {
    ops.push({ op: 'create', ref: `i${n}`, type, title: `${type === 'task' ? 'Step' : 'Ask'} ${n}` }, { op: 'link', type: 'part_of', from: `i${n}`, to: 'site' });
    if (n) ops.push({ op: 'link', type: 'depends_on', from: `i${n}`, to: `i${n - 1}` });
  }
  const made = (await call('/api/change', undefined, { reason: 'test', ops })).result.created as Record<string, string>;
  const questions = [4, 5, 6].map((n) => made[`i${n}`]);
  const page = await open(`${base}/#/v?find=in+${made.site}`);
  const drawn = `[...document.querySelectorAll('#canvas svg a[data-item]')].map((a) => a.dataset.item)`;
  try {
    assert.ok(await page.until(`${drawn}.length >= 7`), `the canvas is drawn: ${page.logs().join('\n')}`);
    const all = await page.evaluate<number>(`${drawn}.length`);
    assert.ok(await page.still());
    // When the old picture went and the new scene came, on the page's clock.
    await page.evaluate(`(() => {
      const first = document.querySelector('#canvas .lf-stage svg');
      window.sceneAt = null;
      new MutationObserver(() => { const svg = document.querySelector('#canvas .lf-stage svg'); if (svg && svg !== first && window.sceneAt === null) window.sceneAt = performance.now(); })
        .observe(document.getElementById('canvas'), { childList: true, subtree: true });
      performance.clearMarks();
      performance.clearMeasures();
      // Each frame until it happens: whether every item that leaves is fading out of the picture shown.
      window.fadedAt = null;
      const gone = ${JSON.stringify(questions)};
      const look = (t) => {
        const els = gone.map((id) => document.querySelector('#canvas svg a[data-item="' + id + '"]'));
        if (els.every((a) => a && a.getAttribute('aria-hidden') === 'true' && a.getAnimations().length > 0)) return void (window.fadedAt = t);
        if (window.sceneAt === null) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    })()`);
    await page.evaluate(`${pageModule('canvas.js')}.then((c) => c.goQuery({ filter: { find: ['in ${made.site}'], not: ['kind system', 'type question'] }, walk: { over: [], steps: 0 } }))`);
    assert.ok(await page.until(`performance.getEntriesByName('narrow shown').length`, 2000), `the narrowed picture is shown: ${page.logs().join('\n')}`);
    const shown = await page.evaluate<any>(`(() => {
      const m = performance.getEntriesByName('narrow shown')[0], at = performance.getEntriesByName('lens-narrow-shown')[0].startTime;
      const edit = performance.getEntriesByName('lens-edit')[0].startTime;
      return { took: m.duration, marks: m.detail.marks, before: window.sceneAt === null || window.sceneAt > at, faded: window.fadedAt !== null && window.fadedAt - edit < ${AT_ONCE} && (window.sceneAt === null || window.fadedAt < window.sceneAt) };
    })()`);
    assert.ok(shown.took < AT_ONCE, `the picture changes at once after the edit (${Math.round(shown.took)} ms)`);
    assert.ok(shown.before, 'it changes before the drawing has laid out the new answer');
    assert.ok(shown.faded, `each item that left fades out of the picture shown: ${JSON.stringify(shown)}`);
    // Their wires with them: three questions, the two depends_on between them and the one to the last task, their part_of ties.
    assert.ok(shown.marks > questions.length, `the wires that touched them go too (${shown.marks} marks)`);
    // The new scene lands, and what stayed glides there.
    assert.ok(await page.until(`window.sceneAt !== null && ${drawn}.length === ${all - 3}`, 5000), 'the layout of the new answer lands');
    // What stayed is matched with where it was: moved (and grown, where the picture was fitted again) or left where it
    // is, never cut to its place or brought in anew. The plan is made in the frame after the scene is mounted
    // (packs/walls/page/transition.js): on a busy machine that frame comes after the scene is seen.
    assert.ok(await page.until(`document.querySelector('#canvas .lens-view').transitionPlan !== undefined`, 5000), 'the move to the new scene is planned');
    const plan = await page.evaluate<any>(`(({ cut, move, arrive }) => ({ cut, moved: move.map((m) => m.key), arrive }))(document.querySelector('#canvas .lens-view').transitionPlan)`);
    assert.ok(plan.cut === null || plan.cut === 'still', `it plays: ${JSON.stringify(plan)}`);
    assert.deepEqual(plan.arrive.filter((k: string) => k.startsWith('s:')), [], 'nothing that stayed comes in anew');
    assert.ok(await page.still());
    const hash = `(() => { const v = document.querySelector('#canvas .lens-view'); return JSON.stringify([v.scene.svg, v.querySelector('.lf-stage svg').outerHTML]); })()`;
    const settled = await page.evaluate<string>(hash);
    const address = await page.evaluate<string>('location.hash');
    // The same address, laid out fresh in a page of its own.
    const fresh = await open(`${base}/${address}`);
    try {
      assert.ok(await fresh.until(`${drawn}.length === ${all - 3}`), 'the narrowed address draws on its own');
      assert.ok(await fresh.still());
      assert.equal(await fresh.evaluate<string>(hash), settled, 'the picture settled on is the one the answer draws');
    } finally {
      await fresh.close();
    }
  } finally {
    await page.close();
  }
});
