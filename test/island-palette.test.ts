// The island picker in a real browser (packs/surface/page/island-picker.js, island-palette.js; Alex, 17 Nov 2026): the
// side list at the canvas's left edge, every island in it by pack, and the palette on Ctrl+K. Typed into, the palette
// finds an island by its name, Enter puts it on and the canvas draws it; the side list then has it among those on.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';
import { until as holds } from './wait.ts';

const browser = chrome();

test('in a browser, the palette finds an island as it is typed and Enter puts it on', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  await call('/api/workspace_set', undefined, { islands: true });
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'harbour', type: 'island', title: 'Harbour works', props: { pack: 'core' } },
      { op: 'create', ref: 'quarry', type: 'island', title: 'Quarry', props: { pack: 'core' } },
      { op: 'create', ref: 'pier', type: 'task', title: 'Rebuild the pier', props: { island: '{harbour}' } },
      { op: 'create', ref: 'stone', type: 'task', title: 'Cut the stone', props: { island: '{quarry}' } },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const key = (k: string, more: Record<string, unknown> = {}) =>
    ['keyDown', 'keyUp'].reduce((p, type) => p.then(() => page.send('Input.dispatchKeyEvent', { type, key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 13, ...more })), Promise.resolve() as Promise<unknown>);
  const draws = (words: string) => page.evaluate<boolean>(`document.querySelector('#canvas svg')?.textContent.includes(${JSON.stringify(words)}) ?? false`);
  try {
    // The side list is up, every island in it in a group by its pack.
    await until('the side list', () => page.evaluate<boolean>(`document.querySelectorAll('#islands .isl-group').length > 0`));
    assert.match(await page.evaluate<string>(`document.querySelector('#islands .isl-head').textContent`), /On · 0/);
    assert.equal(await draws('Rebuild the pier'), false, 'nothing on yet');
    // Ctrl+K opens the palette over the canvas; typed into, it finds the island by a word of its name.
    await key('k', { modifiers: 2 });
    await until('the palette open', () => page.evaluate<boolean>(`!document.getElementById('palette').hidden && document.activeElement?.classList.contains('pal-find')`));
    await page.send('Input.insertText', { text: 'harb' });
    await until('it finds the island', () => page.evaluate<boolean>(`document.querySelector('#palette .pal-row[aria-selected="true"] .pal-name')?.textContent === 'Harbour works'`));
    assert.equal(await page.evaluate<number>(`document.querySelectorAll('#palette .pal-row').length`), 1, 'only what matches');
    // Enter puts it on: the palette shuts, the canvas draws it, and the side list has it among those on.
    await key('Enter');
    await until('the canvas draws it', () => draws('Rebuild the pier'));
    assert.equal(await page.evaluate<boolean>(`document.getElementById('palette').hidden`), true);
    await until('the side list has it on', () => page.evaluate<boolean>(`document.querySelector('#islands .isl-head').textContent.includes('On · 1') && [...document.querySelectorAll('#islands .isl-row .isl-name')].some((n) => n.textContent === 'Harbour works')`));
    assert.equal(await draws('Cut the stone'), false, 'the other island stays off');
    assert.ok(made.harbour);
  } finally {
    await page.close();
  }
});
