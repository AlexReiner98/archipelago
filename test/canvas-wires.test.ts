// The canvas in a real browser (skipped where there is no Chrome): a click on a step opens its page with the canvas
// where it stands and the step lit; no wire is drawn by hand. An agent's held link is drawn dashed where it would
// land and applied there by the person; an agent's held item is a faint step, declined there.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, opening a step keeps the canvas still and lights it, and a held change is decided where it would land', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'project', title: 'Wired here' },
      { op: 'create', ref: 'a', type: 'task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'task', title: 'Second step' },
      { op: 'create', ref: 'd', type: 'task', title: 'Third step' },
      { op: 'link', type: 'part_of', from: 'a', to: 'p' },
      { op: 'link', type: 'part_of', from: 'b', to: 'p' },
      { op: 'link', type: 'part_of', from: 'd', to: 'p' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?from=${made.p}`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(50)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const step = (id: string) => `document.querySelector('#canvas svg a[href="#/e/${id}"]')`;
  const rect = (el: string) => page.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => { const r = ${el}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const mouse = (type: string, at: [number, number], buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const click = async (at: [number, number]) => (await mouse('mouseMoved', at, 0), await mouse('mousePressed', at), await mouse('mouseReleased', at, 0));
  /** Press the dialog's button whose words match. */
  const choose = (words: RegExp) => page.evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('dialog.ask button')].find((b) => ${words}.test(b.textContent)); b?.click(); return Boolean(b); })()`);
  const links = async (id: string) => (await call('/api/get', undefined, { id })).result.outgoing.map((r: { type: string; id: string }) => `${r.type} ${r.id}`) as string[];
  const probe = () => page.evaluate<string>(`JSON.stringify({ wires: [...document.querySelectorAll('#canvas svg[role=img] .lf-wire, #canvas svg[role=img] .lf-tie')].map((p) => p.getAttribute('class')), ghosts: document.querySelectorAll('#canvas .lf-step.ghost').length, badges: document.querySelectorAll('#canvas .lf-held').length, dialog: document.querySelector('dialog.ask')?.textContent })`);
  try {
    assert.ok(await until(`Boolean(${step(made.a)}) && Boolean(${step(made.b)})`), `the steps are drawn: ${await page.evaluate("document.querySelector('#canvas')?.innerText.slice(0, 600)")} ${page.logs().join('\n')}`);
    await wait(800);

    // ---- A click on a step of a picture nobody moved fits it to the room beside the sheet; shut, to the whole page.
    const fitted = await rect(step(made.a));
    await click([fitted.x + fitted.w / 2, fitted.y + fitted.h / 2]);
    assert.ok(await until(`document.body.dataset.sheet === 'open'`, 5000), 'its page is open');
    await wait(600);
    const beside = await rect(step(made.a));
    assert.ok(beside.x < fitted.x - 100, `the click moved nothing, so it fits again beside the sheet: ${JSON.stringify([fitted, beside])}`);
    await page.evaluate(`document.getElementById('sheet-close').click()`);
    assert.ok(await until(`!document.body.dataset.sheet`, 5000), 'shut');
    await wait(600);
    const whole = await rect(step(made.a));
    assert.ok(Math.abs(whole.x - fitted.x) < 1, `shut, it fits the page again: ${JSON.stringify([fitted, whole])}`);

    // ---- A click on a step opens its page over the canvas: the canvas stays where it stands, as the reader moved and
    // zoomed it, the step lit; shut, it is still there.
    const box = await rect(`document.querySelector('#canvas .pane-canvas')`);
    const from: [number, number] = [box.x + 30, box.y + box.h - 80];
    await mouse('mousePressed', from);
    for (let k = 1; k <= 6; k++) await mouse('mouseMoved', [from[0] + k * 12, from[1] - k * 6]);
    await mouse('mouseReleased', [from[0] + 72, from[1] - 36], 0);
    const near = await rect(step(made.a));
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: near.x + near.w / 2, y: near.y + near.h / 2, deltaX: 0, deltaY: -120 });
    await wait(600);
    const before = await rect(step(made.a));
    // Where the plane stands and its scale: the pane narrows beside the sheet, and a step past its edge is put out of the picture until it is back in view.
    const plane = () => page.evaluate<number[]>(`(() => { const svg = document.querySelector('#canvas svg[role=img]'), [x, y, w] = svg.getAttribute('viewBox').split(' ').map(Number); return [x, y, svg.clientWidth / w]; })()`);
    const stood = await plane();
    await click([before.x + before.w / 2, before.y + before.h / 2]);
    assert.ok(await until(`document.body.dataset.sheet === 'open' && Boolean(document.querySelector('#canvas .lf-step.here'))`, 5000), `its page is open, the step lit: ${await page.evaluate(`JSON.stringify([document.body.dataset.sheet, location.hash, document.querySelectorAll('#canvas .lf-step.here').length, document.querySelectorAll('.lf-step.here').length])`)} ${await probe()}`);
    await wait(600);
    const after = await plane();
    assert.ok(after.every((n, i) => Math.abs(n - stood[i]) < 0.01), `the canvas does not move: ${JSON.stringify([stood, after])}`);
    await page.evaluate(`document.getElementById('sheet-close').click()`);
    assert.ok(await until(`!document.body.dataset.sheet && !document.querySelector('#canvas .lf-step.here')`, 5000), 'shut, nothing lit');
    await wait(600);
    const shut = await rect(step(made.a));
    assert.ok(Math.abs(shut.x - before.x) < 1 && Math.abs(shut.w - before.w) < 1, `shut, it stays where the reader left it: ${JSON.stringify([before, shut])}`);

    // ---- A step's edge draws no wire: a press there is a click, as anywhere on it.
    assert.ok(!(await page.evaluate<boolean>(`'wire' in document.querySelector('#canvas .lens-view').dataset`)), 'no wire is offered');

    // ---- An agent's held link, drawn dashed where it would land, applied there.
    const held = (await call('/agent/change', undefined, { actor: 'robot', reason: 'held link test', ops: [{ op: 'link', type: 'depends_on', from: made.d, to: made.b }] })).result;
    assert.ok(held.proposal, 'the agent’s link waits for the owner');
    const badge = (words: string) => `[...document.querySelectorAll('#canvas .lf-held')].find((g) => g.querySelector('title')?.textContent.includes(${JSON.stringify(words)}))`;
    assert.ok(await until(`Boolean(document.querySelector('#canvas svg[role=img] .lf-wire.held:not(.mine)')) && Boolean(${badge('held link test')})`), `drawn dashed, with its badge: ${await probe()}`);
    assert.ok(!(await links(made.d)).some((l) => l.startsWith('depends_on')), 'not yet on the map');
    const at = await rect(badge('held link test'));
    await click([at.x + at.w / 2, at.y + at.h / 2]);
    assert.ok(await until(`Boolean(document.querySelector('#sheet .held-band'))`, 5000), `the change is put to the person on the sheet of what it touches: ${await probe()}`);
    assert.ok(await page.evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('#sheet .held-band button')].find((b) => b.textContent === 'Apply'); b?.click(); return Boolean(b); })()`));
    assert.ok(await until(`!document.querySelector('#canvas svg[role=img] .held') && document.querySelectorAll('#canvas svg[role=img] .lf-wire').length === 1`), `applied in place, drawn as it is: ${await probe()}`);
    assert.ok((await links(made.d)).includes(`depends_on ${made.b}`), 'on the map');
    assert.ok((await call('/api/proposals', undefined, { status: 'approved' })).result.some((p: { id: string }) => p.id === held.proposal), 'approved through decide');

    // ---- An agent's held item, a faint step where it would land, declined there.
    await page.evaluate(`document.getElementById('sheet-close').click()`);
    assert.ok(await until(`!document.body.dataset.sheet`, 5000), 'the sheet is shut again');
    await call('/agent/change', undefined, { actor: 'robot', reason: 'held item test', ops: [{ op: 'create', ref: 'e', type: 'task', title: 'Proposed step' }, { op: 'link', type: 'part_of', from: 'e', to: made.p }] });
    assert.ok(await until(`[...document.querySelectorAll('#canvas .lf-step.ghost')].some((g) => g.textContent.includes('Proposed step')) && Boolean(${badge('held item test')})`), `a faint step: ${await probe()}`);
    const ghostAt = await rect(badge('held item test'));
    await click([ghostAt.x + ghostAt.w / 2, ghostAt.y + ghostAt.h / 2]);
    assert.ok(await until(`Boolean(document.querySelector('#sheet .held-band'))`, 5000), `its sheet holds the band: ${await page.evaluate<string>(`location.hash + ' | ' + document.querySelector('#sheet')?.innerText.slice(0, 200)`)}`);
    assert.ok(await page.evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('#sheet .held-band button')].find((b) => b.textContent === 'Decline'); b?.click(); return Boolean(b); })()`));
    assert.ok(await until(`Boolean(document.querySelector('dialog.ask textarea'))`, 5000), 'asked why, as Home asks');
    await page.evaluate(`[...document.querySelectorAll('dialog.ask button')].find((b) => b.textContent === 'Decline').click()`);
    assert.ok(await until(`!document.querySelector('#canvas .lf-step.ghost') && !document.querySelector('#canvas .lf-held')`), `declined, gone: ${await probe()}`);
    assert.equal((await call('/api/proposals', undefined, {})).result.length, 0, 'nothing waits');
  } finally {
    await page.close();
  }
});

test('in a browser, a change that only makes an item is drawn when it is all that is held, and its row opens its sheet', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  await call('/agent/change', undefined, { actor: 'robot', reason: 'held alone', ops: [{ op: 'create', type: 'task', title: 'Nothing else held' }] });
  const page = await open(`${base}/#/v?find=held&shape=list`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(50)) if (await page.evaluate(expression)) return true;
    return false;
  };
  try {
    const row = `[...document.querySelectorAll('#canvas a')].find((a) => a.textContent.includes('Nothing else held'))`;
    assert.ok(await until(`Boolean(${row})`), `drawn, though the query finds nothing yet: ${await page.evaluate("document.querySelector('#canvas')?.innerText")}`);
    await page.evaluate(`${row}.click()`);
    assert.ok(await until(`Boolean(document.querySelector('#sheet .held-band'))`, 5000), `its sheet holds the band: ${await page.evaluate('location.hash')}`);
  } finally {
    await page.close();
  }
});
