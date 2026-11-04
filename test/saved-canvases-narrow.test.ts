// A canvas saved from the bar at 560 px, beside one saved before at 1280 (test/saved-canvases.test.ts): listed on
// Home one line each.

import { test } from 'node:test';
import { chrome } from './browser.ts';
import { savedCanvasPage } from './saved-canvas-page.ts';

const browser = chrome();

test('in a browser, a canvas is saved from the bar at 560 px and listed on Home', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { page, keptBefore, savePass } = await savedCanvasPage();
  try {
    await keptBefore(1280);
    await savePass(560);
  } finally {
    await page.close();
  }
});
