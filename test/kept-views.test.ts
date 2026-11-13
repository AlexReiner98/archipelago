// What still drew from the old lens, drawn from flat lenses (task e_vtvhebut), in a real browser (skipped where there
// is no Chrome): a kept view, opened as a canvas, drawn flat; and a picture an owner's screen draws on Home (what is
// coming). An item's page is bare (task e_cbjpfd2f; the owner, 26 Oct 2026: bare means bare): a company's page draws
// no pack's screen.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import * as S from './sheet-page.ts';

const browser = chrome();

test('in a browser, a kept view is drawn as a canvas, the owner’s screen draws Home, and an item’s page is bare', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off');
  const change = async (body: unknown) => {
    const got = await call('/api/change', undefined, body);
    assert.ok(got.result?.created, JSON.stringify(got.error ?? got));
    return got.result.created as Record<string, string>;
  };
  const made = await change({
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'task', title: 'A system' },
      { op: 'create', ref: 'e', type: 'place', title: 'A server', status: 'available' },
      { op: 'create', ref: 'a', type: 'place', title: 'Doors', status: 'available' },
      { op: 'create', ref: 'b', type: 'place', title: 'Store', status: 'available' },
      { op: 'link', type: 'part_of', from: 'e', to: 'p' },
      { op: 'link', type: 'part_of', from: 'a', to: 'e' },
      { op: 'link', type: 'part_of', from: 'b', to: 'e' },
      { op: 'link', type: 'uses', from: 'a', to: 'b' },
      { op: 'create', ref: 'r', type: 'event', title: 'Version 2.0' },
      { op: 'create', ref: 'old', type: 'event', title: 'Version 0.1', status: 'happened' },
      { op: 'create', ref: 'co', type: 'company', title: 'Client Co' },
    ],
  });
  const kept = await change({
    reason: 'test',
    ops: [
      { op: 'create', ref: 'l', type: 'lens', title: 'What talks to what', props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of', 'uses'], steps: 3 }, style: { shape: 'map' } } },
      { op: 'link', type: 'about', from: 'l', to: made.p },
      // Home is the owner's to fill: a screen of their own drawing what is coming put on it.
      { op: 'create', type: 'screen', title: 'Coming', status: 'current', props: { pieces: [{ piece: 'picture', lens: { filter: { find: ['type event'], not: ['done', 'kind system'] } }, style: { shape: 'list' } }], home: true } },
    ],
  });
  const page = await open(`${base}/#/v?canvas=${kept.l}`);
  const linked = (scope: string, id: string) => `Boolean(document.querySelector('${scope} a[href="#/e/${id}"]'))`;
  try {
    // The kept view, opened as a canvas: drawn flat as the map (depth is never drawn on the canvas), the system and both
    // parts; the server they are part of is a place, drawn as a colour on their outlines, not a step.
    assert.ok(await page.until(`${linked('#canvas', made.a)} && ${linked('#canvas', made.b)} && ${linked('#canvas', made.p)} && !${linked('#canvas', made.e)}`), `the view is drawn as a canvas: ${page.logs().join('\n')}`);

    // Home: the owner's screen, what is coming.
    await page.go(`${base}/#/v?find=id+${made.p}`);
    await page.go(`${base}/#/you`);
    assert.ok(await page.until(linked('.lens-card', made.r)), `what is coming drawn on Home: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate<boolean>(linked('.lens-card', made.old))), 'not what has happened');

    // A company: its page is bare, with no pack's screen drawn on it.
    await page.go(`${base}/#/e/${made.co}`);
    assert.ok(await page.until(`${S.title} === 'Client Co'`), `the company's page: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate<boolean>(`Boolean(document.querySelector('#sheet .lens-card'))`)), 'no pack screen on a bare page');
  } finally {
    await page.close();
  }
});
