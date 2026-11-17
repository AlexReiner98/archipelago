// The island picker in a real browser (packs/surface/page/island-picker.js; Alex, 17 Nov 2026): the side list at the
// canvas's left edge, the islands changed lately first, then the rest by name. Ctrl+K folds it open with its search in focus; typed into, it lists
// what it finds within the bar, Enter puts the lit island on and the canvas draws it; the list then has it among those on.
// Folded, the bar is its rail alone, and the rail opens it again.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, pageModule } from './browser.ts';
import { serve } from './serve.ts';
import { until as holds } from './wait.ts';

const browser = chrome();

test('in a browser, Ctrl+K finds an island in the side bar as it is typed and Enter puts it on', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  await call('/api/workspace_set', undefined, { islands: true });
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'harbour', type: 'island', title: 'Harbour works', props: { pack: 'core' } },
      { op: 'create', ref: 'quarry', type: 'island', title: 'Quarry', props: { pack: 'core' } },
      { op: 'create', ref: 'named', type: 'island', title: 'Core', props: { pack: 'core' } },
      { op: 'create', ref: 'pier', type: 'task', title: 'Rebuild the pier', props: { island: '{harbour}' } },
      { op: 'create', ref: 'stone', type: 'task', title: 'Cut the stone', props: { island: '{quarry}' } },
    ],
  })).result.created as Record<string, string>;
  // An island's time is when work last changed on it: a change to an item on it, after the island's own.
  await new Promise((r) => setTimeout(r, 20));
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.pier, title: 'Rebuild the pier again' }] });
  const islands = (await call('/api/search', undefined, { islands: true, limit: 50 })).result as { id: string; updated_at: string; worked_at: string }[];
  const harbour = islands.find((i) => i.id === made.harbour)!;
  assert.ok(Date.parse(harbour.worked_at) > Date.parse(harbour.updated_at), 'worked on after it was made');
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  const key = (k: string, more: Record<string, unknown> = {}) =>
    ['keyDown', 'keyUp'].reduce((p, type) => p.then(() => page.send('Input.dispatchKeyEvent', { type, key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 13, ...more })), Promise.resolve() as Promise<unknown>);
  const draws = (words: string) => page.evaluate<boolean>(`document.querySelector('#canvas svg')?.textContent.includes(${JSON.stringify(words)}) ?? false`);
  try {
    // The side list is up: no pack groups, the islands changed lately first (both were just made), by latest.
    await until('the side list', () => page.evaluate<boolean>(`[...document.querySelectorAll('#islands .isl-head')].some((h) => /^Recent · [0-9]/.test(h.textContent))`));
    assert.equal(await page.evaluate<number>(`document.querySelectorAll('#islands .isl-group').length`), 0, 'no pack groups');
    // An island named as its pack shows no pack.
    assert.equal(await page.evaluate<string>(`(() => { const r = [...document.querySelectorAll('#islands .isl-row')].find((r) => r.querySelector('.isl-name').textContent === 'Core'); return r ? String(r.querySelectorAll('.isl-pack').length) : 'no row'; })()`), '0');
    assert.match(await page.evaluate<string>(`document.querySelector('#islands .isl-head').textContent`), /On · 0/);
    assert.equal(await draws('Rebuild the pier again'), false, 'nothing on yet');
    // Folded, the bar is its rail; Ctrl+K opens it with its search in focus, and nothing is drawn outside it.
    await page.evaluate(`document.querySelector('#islands .isl-rail').click()`);
    await until('folded to its rail', () => page.evaluate<boolean>(`document.body.dataset.islands === 'folded' && getComputedStyle(document.querySelector('#islands .isl-panel')).display === 'none'`));
    await key('k', { modifiers: 2 });
    await until('open, its search in focus', () => page.evaluate<boolean>(`document.body.dataset.islands === 'open' && document.activeElement?.classList.contains('isl-search')`));
    // A search that finds nothing says so, in one row.
    assert.equal(await page.evaluate<string>(`(() => { const i = document.querySelector('#islands .isl-search'); i.value = 'zzqx'; i.dispatchEvent(new Event('input')); const t = document.querySelector('#islands .isl-none')?.textContent; i.value = ''; i.dispatchEvent(new Event('input')); return t; })()`), 'Nothing named “zzqx”');
    // Typed into, it finds the island by a word of its name, within the bar.
    assert.equal(await page.evaluate<string>(`getComputedStyle(document.querySelector('#islands .isl-key')).display`) === 'none', false, 'its shortcut shows while empty');
    await page.send('Input.insertText', { text: 'harb' });
    assert.equal(await page.evaluate<string>(`getComputedStyle(document.querySelector('#islands .isl-key')).display`), 'none', 'and goes once typed into');
    await until('it finds the island', () => page.evaluate<boolean>(`document.querySelector('#islands .isl-hit[aria-selected="true"] .isl-name')?.textContent === 'Harbour works'`));
    assert.equal(await page.evaluate<number>(`document.querySelectorAll('#islands .isl-hit').length`), 1, 'only what matches');
    // A found row names its pack at its right, muted and cut with an ellipsis, so like names are told apart.
    assert.deepEqual(await page.evaluate<string[]>(`(() => { const c = document.querySelector('#islands .isl-hit .isl-pack'), s = getComputedStyle(c); return [c.textContent, s.textOverflow, String(s.color === getComputedStyle(document.querySelector('#islands .isl-hit .isl-name')).color)]; })()`), ['Core', 'ellipsis', 'false']);
    // No tooltip on a row whose name shows whole.
    assert.equal(await page.evaluate<number>(`(() => { const n = document.querySelector('#islands .isl-hit .isl-name'); n.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); return document.querySelectorAll('#islands .isl-hit[title], #islands .isl-hit [title]').length; })()`), 0, 'no tooltip on a whole name');
    // The keyboard's row has the accent bar at its left edge, not a hover's ground.
    assert.match(await page.evaluate<string>(`getComputedStyle(document.querySelector('#islands .isl-hit[aria-selected="true"]')).boxShadow`), /inset/);
    assert.ok(await page.evaluate<boolean>(`(() => { const bar = document.getElementById('islands').getBoundingClientRect(); return [...document.querySelectorAll('#islands .isl-hit')].every((r) => r.getBoundingClientRect().right <= bar.right); })()`), 'within the bar');
    // Enter puts it on: the canvas draws it, and the side list has it among those on.
    await key('Enter');
    await until('the canvas draws it', () => draws('Rebuild the pier again'));
    await until('the side list has it on', () => page.evaluate<boolean>(`document.querySelector('#islands .isl-head').textContent.includes('On · 1') && [...document.querySelectorAll('#islands .isl-row .isl-name')].some((n) => n.textContent === 'Harbour works')`));
    assert.equal(await draws('Cut the stone'), false, 'the other island stays off');
    // The list is in parts, each a band: On on the canvas's ground, its names larger; every island on has its dot.
    assert.ok(await page.evaluate<boolean>(`(() => { const on = document.querySelector('#islands .isl-sec-on'), rest = document.querySelector('#islands .isl-sec-recent, #islands .isl-sec-all'); return getComputedStyle(on).backgroundColor !== getComputedStyle(rest).backgroundColor && parseFloat(getComputedStyle(on.querySelector('.isl-name')).fontSize) > parseFloat(getComputedStyle(rest.querySelector('.isl-name')).fontSize); })()`), 'On stands apart');
    // A row under On is its name and ×, without its pack, so the name has the room.
    assert.equal(await page.evaluate<number>(`document.querySelector('#islands .isl-head').nextElementSibling.querySelectorAll('.isl-pack').length`), 0, 'no pack under On');
    // A press on an island under Recent puts it on where its row stands: the row lights and gains ×, and nothing moves.
    const quarry = `[...document.querySelectorAll('#islands .isl-row')].find((r) => r.querySelector('.isl-name')?.textContent === 'Quarry')`;
    await until('Quarry under Recent', () => page.evaluate<boolean>(`Boolean(${quarry}) && /^Recent/.test(${quarry}.parentElement.previousElementSibling.textContent)`));
    // The canvas's way to an island, stood in for: it records where it is asked to go.
    await page.evaluate(`(async () => { const { hooks } = await ${pageModule('base.js')}; window.wentTo = []; hooks.toIsland = (id) => (wentTo.push(id), true); })()`);
    const before = await page.evaluate<number>(`Math.round(${quarry}.getBoundingClientRect().top)`);
    await page.evaluate(`${quarry}.querySelector('button.isl-name').click()`);
    await until('Quarry on, its dot shown', () => page.evaluate<boolean>(`getComputedStyle(${quarry}, '::before').content.includes('•')`));
    await until('Quarry on, its row lit where it stood', () => page.evaluate<boolean>(`(() => { const r = ${quarry}; return r?.classList.contains('on') && Boolean(r.querySelector('.isl-off')) && Math.round(r.getBoundingClientRect().top) === ${before} && document.querySelector('#islands .isl-head').textContent.includes('On · 2'); })()`));
    // Put on, the canvas is brought to it, and it is marked as where the canvas went.
    await until('the canvas brought to Quarry', () => page.evaluate<boolean>(`wentTo.includes(${JSON.stringify(made.quarry)}) && ${quarry}.getAttribute('aria-current') === 'location'`));
    await page.evaluate(`(async () => { const { hooks } = await ${pageModule('base.js')}; delete hooks.toIsland; })()`);
    // A press on an island that is on brings the canvas to it (hooks.toIsland, the canvas's).
    const went = await page.evaluate<string>(`(async () => { const { hooks } = await ${pageModule('base.js')}; const had = hooks.toIsland; let to = ''; hooks.toIsland = (id) => ((to = id), true); ${quarry}.querySelector('button.isl-name').click(); hooks.toIsland = had; return to; })()`);
    assert.equal(went, made.quarry, 'the press asks the canvas for the island');
    // Under On, the island the canvas was brought to has the accent bar at its left edge.
    assert.equal(await page.evaluate<string | null>(`${quarry}.getAttribute('aria-current')`), 'location');
    // Taken off, Harbour works stays under On while the pointer is in the bar, and leaves On once it leaves the bar.
    const harbourRow = `[...document.querySelectorAll('#islands .isl-row')].find((r) => r.querySelector('.isl-name')?.textContent === 'Harbour works')`;
    const underOn = `${harbourRow}.parentElement.previousElementSibling.textContent.startsWith('On')`;
    await page.evaluate(`${harbourRow}.querySelector('.isl-off').click()`);
    await until('Harbour off where it stood', () => page.evaluate<boolean>(`!${harbourRow}.classList.contains('on') && ${underOn}`));
    await page.evaluate(`document.getElementById('islands').dispatchEvent(new PointerEvent('pointerleave'))`);
    await until('Harbour gone from On', () => page.evaluate<boolean>(`!${underOn}`));
    // The list is one stop, worked with arrows: down from the search line lights its first row, End its last.
    await page.evaluate(`document.querySelector('#islands .isl-search').focus()`);
    await key('ArrowDown');
    const lit = `document.querySelector('#islands .isl-row[data-lit]')?.dataset.id`;
    await until('the list in focus, its first row lit', () => page.evaluate<boolean>(`document.activeElement?.classList.contains('isl-body') && ${lit} === document.querySelector('#islands .isl-row[data-id]').dataset.id`));
    assert.equal(await page.evaluate<number>(`document.querySelectorAll('#islands .isl-body [tabindex="-1"]').length > 0 && document.querySelectorAll('#islands .isl-body button:not([tabindex="-1"])').length`), 0, 'no row is a tab stop');
    await key('End');
    await until('the last row lit', () => page.evaluate<boolean>(`${lit} === [...document.querySelectorAll('#islands .isl-row[data-id]')].at(-1).dataset.id`));
    await key('Escape');
    await until('back to the search line', () => page.evaluate<boolean>(`document.activeElement?.classList.contains('isl-search') && !document.querySelector('#islands .isl-row[data-lit]')`));
    // Found again while it is on, Quarry reads as on, and Enter goes to it rather than doing nothing.
    await page.evaluate(`(async () => { const { hooks } = await ${pageModule('base.js')}; window.wentTo = []; hooks.toIsland = (id) => (wentTo.push(id), true); })()`);
    await page.evaluate(`document.querySelector('#islands .isl-search').focus()`);
    await page.send('Input.insertText', { text: 'quarry' });
    await until('Quarry found, on', () => page.evaluate<boolean>(`document.querySelector('#islands .isl-hit[aria-selected="true"]')?.classList.contains('on') ?? false`));
    await key('Enter');
    await until('Enter went to it', () => page.evaluate<boolean>(`wentTo.includes(${JSON.stringify(made.quarry)})`));
    await page.evaluate(`(async () => { const { hooks } = await ${pageModule('base.js')}; delete hooks.toIsland; })()`);
    // Dragged, the rail widens the bar, the canvas beside it, and the width is kept; a double-click gives it back.
    const width = `Math.round(document.getElementById('islands').getBoundingClientRect().width)`;
    const was = await page.evaluate<number>(width);
    const [rx, ry] = await page.evaluate<[number, number]>(`(() => { const r = document.querySelector('#islands .isl-rail').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx + 40, y: ry, button: 'left' });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx + 80, y: ry, button: 'left' });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx + 80, y: ry, button: 'left', clickCount: 1 });
    await until('the bar wider, still open', () => page.evaluate<boolean>(`document.body.dataset.islands === 'open' && Math.abs(${width} - ${was + 80}) <= 1 && JSON.parse(localStorage.getItem('pelago-islands-side:width')) > ${was}`));
    await page.evaluate(`document.querySelector('#islands .isl-rail').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await until('the default width back', () => page.evaluate<boolean>(`${width} === ${was} && localStorage.getItem('pelago-islands-side:width') === 'null'`));
    // The canvas draws beside the bar, open or folded, never under it.
    const beside = `(() => { const bar = document.getElementById('islands').getBoundingClientRect(), pane = document.querySelector('#canvas .pm-pane').getBoundingClientRect(); return Math.abs(pane.left - bar.right) < 1; })()`;
    assert.ok(await page.evaluate<boolean>(beside), 'beside the open bar');
    await page.evaluate(`document.querySelector('#islands .isl-rail').click()`);
    await until('beside the folded rail', () => page.evaluate<boolean>(`document.body.dataset.islands === 'folded' && ${beside}`));
    // In a narrow window the bar opened lies over the canvas, which stays at the rail, and a press on the canvas folds it.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 560, height: 800, deviceScaleFactor: 1, mobile: false });
    await until('narrow: the bar goes over', () => page.evaluate<boolean>(`document.body.dataset.islandsOver === 'on'`));
    await page.evaluate(`document.querySelector('#islands .isl-rail').click()`);
    await until('open over the canvas', () => page.evaluate<boolean>(`(() => { const bar = document.getElementById('islands').getBoundingClientRect(), pane = document.querySelector('#canvas .pm-pane').getBoundingClientRect(); return document.body.dataset.islands === 'open' && pane.left < bar.right - 1; })()`));
    await page.evaluate(`document.getElementById('canvas').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    await until('a press on the canvas folds it', () => page.evaluate<boolean>(`document.body.dataset.islands === 'folded'`));
    assert.ok(made.harbour);
  } finally {
    await page.close();
  }
});
