// The flow drawing the core pack ships (packs/core/layouts/flow/), in a real browser (skipped where there is no
// Chrome): it draws what the kernel's own flow drew (ui/flow.js, until 23 Oct 2026), mark for mark, look for look.

import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { flowCases } from './layout-cases.ts';
import { drawsAsBefore, golden } from './layout-golden.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, the flow drawing draws what the kernel drew: the same marks, looks, hovering, lighting and key', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off');
  // The pack's flow drawing, as a picture with nothing kept for it is sent it.
  const { drawing } = (await call('/api/view', undefined, { name: 'style', params: { have: [] } })).result.style;
  const page = await open(`${base}/`);
  try {
    await drawsAsBefore(page, flowCases(), drawing, 'lf-step', golden('flow'));
  } finally {
    await page.close();
  }
});
