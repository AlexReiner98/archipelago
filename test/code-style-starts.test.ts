// A style's own code starts however the page got to its view (task e_vbmkhnyb): opened from Home, as by loading its
// address. In a real browser, sandboxed: the code puts a field over its canvas saying the size it was started at, so
// the test sees it ran and was given room to draw in.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// It says so from its first frame, as a drawing that animates paints: a frame never given one paints nothing.
const CODE = `export default function draw({ canvas, field, size, theme }) {
  const g = canvas.getContext('2d');
  requestAnimationFrame(() => {
    g.fillStyle = theme.accent;
    g.fillRect(0, 0, canvas.width, canvas.height);
    field('size', { x: 20, y: 20, width: 300, height: 30, value: size.width + 'x' + size.height + ' ' + (/^#/.test(theme.accent) && theme.accent !== theme.sea) });
  });
}`;

test('in a browser, a code style opened from Home starts, with room to draw and an accent apart from the ground', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work', title: 'Seed' },
      { op: 'create', ref: 'c', type: 'lens', title: 'Coded', props: { filter: { find: ['type work'] } } },
      { op: 'create', ref: 's', type: 'layout', title: 'Sized', props: { code: CODE } },
    ],
  })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.c, props: { style: { style: made.s } } }] });
  const page = await open(`${base}/#/`);
  try {
    await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    for (let n = 0; n < 50 && !(await page.evaluate(`Boolean(document.querySelector('.home, #canvas'))`)); n++) await wait(200);
    await wait(1000);
    await page.evaluate(`location.hash = '#/v?canvas=${made.c}'`);
    let said = '';
    for (let n = 0; n < 100 && !said; n++, await wait(200)) {
      for (const t of (await page.send('Target.getTargets')).result.targetInfos as { targetId: string; type: string; url: string }[]) {
        if (t.type !== 'iframe' || !new URL(t.url).pathname.endsWith('/draw.html')) continue;
        const session = (await page.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).result.sessionId;
        said = (await page.send('Runtime.evaluate', { expression: `document.querySelector('input.field')?.value ?? ''`, returnByValue: true }, session)).result?.result?.value || said;
      }
    }
    assert.ok(said, `the code ran in its frame: ${page.logs().slice(-5).join(' | ')}`);
    const [w, h, apart] = said.split(/[x ]/);
    assert.ok(Number(w) > 0 && Number(h) > 0, `it was started with room to draw in, not ${said}`);
    assert.equal(apart, 'true', 'its theme gives an accent that is not the ground');
    const error = await page.evaluate(`[...document.querySelectorAll('.lens-error')].filter((e) => !e.hidden).map((e) => e.textContent).join(' ')`);
    assert.equal(error, '', 'and nothing went wrong');
  } finally {
    await page.close();
  }
});
