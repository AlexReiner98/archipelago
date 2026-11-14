// New code for a layout swapped into the frame already drawing it (packs/walls/page/style-code.js, packs/walls/page/draw.js,
// task e_75c9jwdu): the same frame, a new worker, handed what the old code's hot() kept as `input.hot`; code with no
// hot() hands on nothing, and the code after it starts from the beginning. Opened (drawings_open), a new frame, handed
// what the old kept through the page. In a real browser (skipped where there is no Chrome). Beside test/layouts-open.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, wait } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

/** A layout's code that says what it was handed in a field, and keeps `kept` with hot() when `kept` is given. */
const code = (version: number, kept?: string) => `// version ${version}
export default function draw({ field, hot }) {
  field('said', { x: 0, y: 0, width: 300, height: 30, value: ${version} + ' ' + (hot === undefined ? 'none' : JSON.stringify(hot)) });
}
${kept ? `export function hot() { return ${kept}; }` : ''}`;

test('in a browser, new code is handed what the old kept, and nothing where it kept nothing: walled in, in the same frame; opened, in a new one', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work', title: 'Seed' },
      { op: 'create', ref: 'c', type: 'lens', title: 'Kept', props: { filter: { find: ['type work'] } } },
      { op: 'create', ref: 's', type: 'layout', title: 'Keeper', props: { code: code(1, `{ zoom: 3, pins: [[1, 2]] }`) } },
    ],
  })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.c, props: { style: { style: made.s } } }] });
  let page = await open(`${base}/#/v?canvas=${made.c}`);
  try {
    await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    // What the code said and how many canvases its frame holds, read in the frame: through the page when it shares the
    // page's origin (opened), else by attaching to it.
    const inFrame = (doc: string) => `(${doc}.querySelector('input.field')?.value ?? '') + ' c' + ${doc}.querySelectorAll('canvas').length`;
    let last = '';
    const said = async (version: number) => {
      for (let n = 0; n < 100; n++, await wait(200)) {
        const near = String(await page.evaluate(`(() => { const d = document.querySelector('iframe.lens-frame')?.contentDocument; return d ? ${inFrame('d')} : ''; })()`));
        if (near.startsWith(`${version} `)) return near;
        for (const t of (await page.send('Target.getTargets')).result.targetInfos as { targetId: string; type: string; url: string }[]) {
          if (t.type !== 'iframe' || !new URL(t.url).pathname.endsWith('/draw.html')) continue;
          const session = (await page.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).result.sessionId;
          const value = String((await page.send('Runtime.evaluate', { expression: inFrame('document'), returnByValue: true }, session)).result?.result?.value ?? '');
          if (value.startsWith(`${version} `)) return value;
          last = value;
        }
      }
      return last;
    };
    const swap = (version: number, kept?: string) => call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.s, props: { code: code(version, kept) } }] });
    assert.equal(await said(1), '1 none c1', 'a first draw is handed nothing');
    await page.evaluate(`document.querySelector('iframe.lens-frame').dataset.first = 'yes'`);
    await swap(2);
    assert.equal(await said(2), '2 {"zoom":3,"pins":[[1,2]]} c1', 'the new code is handed what the old kept, on a canvas of its own');
    await swap(3);
    assert.equal(await said(3), '3 none c1', 'code with no hot() hands on nothing');
    assert.equal(await page.evaluate(`document.querySelectorAll('iframe.lens-frame').length + ' ' + document.querySelector('iframe.lens-frame').dataset.first`), '1 yes', 'the same frame drew all three');

    // Opened: the code cannot be ended in its frame's window, so a new frame is handed what the old kept.
    await page.close();
    assert.equal((await call('/api/workspace_set', undefined, { drawings_open: true })).result.drawings_open, true);
    await swap(4, `{ zoom: 5 }`);
    page = await open(`${base}/#/v?canvas=${made.c}`);
    assert.equal(await said(4), '4 none c1', 'opened, a first draw is handed nothing');
    await swap(5);
    assert.equal(await said(5), '5 {"zoom":5} c1', 'opened, the new frame is handed what the old code kept');
    assert.equal(await page.evaluate(`document.querySelectorAll('iframe.lens-frame').length`), 1, 'the old frame is gone');
  } finally {
    await page.close();
  }
});
