// The way back's press in a real browser (packs/surface/page/way-back.js, task e_f7tbyj8u; skipped where there is no Chrome): it is
// drawn in the top layer, so even an element over the whole page at the highest z-index leaves it in sight and
// pressable; a press draws the island shipped, unpins it and is kept for the island; pressed again it draws its own.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, pageModule } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, nothing covers the way back, and a press draws shipped parts and unpins', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    const got: any = await page.evaluate(`(async () => {
      const { wayBack, shippedOn } = await ${pageModule('way-back.js')};
      localStorage.removeItem('pelago.way-back');
      const said = [];
      // The worst a page could hold: a cover over everything, at the highest z-index, and a menu opened after it.
      const cover = document.createElement('div');
      cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.5)';
      document.body.append(cover);
      const quiet = wayBack({ island: 'e_plain', refined: undefined, redraw: () => {} });
      const shown = () => [...document.querySelectorAll('.way-back')].filter((b) => b.matches(':popover-open')).length;
      const plain = shown();
      quiet.stop();
      const press = wayBack({ island: 'e_trial', refined: { pinned: 'e_v', parts: ['shelf.row'] },
        redraw: (s) => said.push('redraw ' + s), unpin: async (i) => said.push('unpin ' + i) });
      const menu = document.createElement('div');
      menu.popover = 'manual';
      menu.style.cssText = 'inset:0;width:100vw;height:100vh;margin:0';
      document.body.append(menu);
      menu.showPopover();
      await new Promise((r) => setTimeout(r, 50));
      const button = document.querySelector('.way-back-press');
      const at = button.getBoundingClientRect();
      const top = document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
      const label1 = button.textContent;
      button.click();
      await new Promise((r) => setTimeout(r, 50));
      const after = { label: button.textContent, shipped: shippedOn('e_trial'), kept: localStorage.getItem('pelago.way-back') };
      button.click();
      await new Promise((r) => setTimeout(r, 50));
      press.stop();
      return { plain, top: top === button, label1, after, back: shippedOn('e_trial'), said, gone: document.querySelectorAll('.way-back').length };
    })()`);
    assert.equal(got.plain, 0, 'an island drawn as it ships shows no press');
    assert.equal(got.top, true, 'the press is on top of a full-page cover and a menu opened after it');
    assert.match(got.label1, /Shipped parts/);
    assert.deepEqual(got.after, { label: '↺ Own parts', shipped: true, kept: '["e_trial"]' });
    assert.deepEqual(got.said, ['redraw true', 'unpin e_trial', 'redraw false'], 'unpinned once, then the island draws its own again');
    assert.equal(got.back, false);
    assert.equal(got.gone, 0);
  } finally {
    await page.close();
  }
});
