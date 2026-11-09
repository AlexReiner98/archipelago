// The architecture drawing the core pack ships, in a real browser (skipped where there is no Chrome): it draws what the
// kernel drew before it, mark for mark, look for look, and draws in the app as a kept view.

import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { architectureCases } from './layout-cases.ts';
import { drawsAsBefore, golden, system } from './layout-golden.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, the architecture drawing draws what the kernel drew: the same marks, looks, hovering, lighting and key', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off', undefined, undefined, [join(import.meta.dirname, 'fixtures', 'systems')]);
  const { l, s } = await system(call);
  const { drawing } = (await call('/api/view', undefined, { name: 'style', params: { style: s, have: [] } })).result.style;
  const page = await open(`${base}/`);
  try {
    const cases = await drawsAsBefore(page, architectureCases(), drawing, 'ar-part', golden('architecture'));
    // And in the app: the view kept on the map draws it, as a document or a screen brings it in.
    const parts = await page.evaluate(`(async () => {
      const { keptView } = await import('/canvases.js');
      const view = keptView(${JSON.stringify(l)});
      document.body.append(view);
      await view.ready;
      for (let n = 0; n < 200 && !view.querySelector('.lf-stage a.ar-part'); n++) await new Promise((r) => setTimeout(r, 25));
      return view.querySelectorAll('.lf-stage a.ar-part').length;
    })()`);
    assert.equal(parts, 2);
    // A page that draws its body anew keeps the frame drawings run in: the next picture still draws.
    const after = await page.evaluate(`(async () => {
      const { drawWith } = await import('/layout.js');
      const host = document.createElement('div');
      document.body.replaceChildren(host);
      drawWith(host, ${JSON.stringify(cases[0].answer)}, ${JSON.stringify(cases[0].style)}, () => {});
      for (let n = 0; n < 200 && !host.querySelector('.lf-stage svg'); n++) await new Promise((r) => setTimeout(r, 25));
      return host.querySelectorAll('.lf-stage a.ar-part').length;
    })()`);
    assert.equal(after, 21);
  } finally {
    await page.close();
  }
});
