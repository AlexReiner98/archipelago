// Wires drawn by hand and held changes as ghosts, on the canvas in a real browser (skipped where there is no Chrome):
// a wire drawn from a step's edge to another step asks which link it is and makes it through change, drawn at once as
// the person's and pending, then as it is once its fact arrives; one refused is taken back. An agent's held link is
// drawn dashed where it would land and applied there by the person; an agent's held item is a faint step, declined
// there.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a wire drawn by hand becomes a link, and a held change is drawn and decided where it would land', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'work.project', title: 'Wired here' },
      { op: 'create', ref: 'a', type: 'work.task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'work.task', title: 'Second step' },
      { op: 'create', ref: 'd', type: 'work.task', title: 'Third step' },
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
  /** Whether the map has this link within a few seconds: the page draws a wire as pending before its change has answered. */
  const linked = async (id: string, link: string) => {
    for (const end = Date.now() + 5000; Date.now() < end; await wait(150)) if ((await links(id)).includes(link)) return true;
    return false;
  };
  const probe = () => page.evaluate<string>(`JSON.stringify({ wires: [...document.querySelectorAll('#canvas svg[role=img] .lf-wire, #canvas svg[role=img] .lf-tie')].map((p) => p.getAttribute('class')), ghosts: document.querySelectorAll('#canvas .lf-step.ghost').length, badges: document.querySelectorAll('#canvas .lf-held').length, dialog: document.querySelector('dialog.ask')?.textContent })`);
  try {
    assert.ok(await until(`Boolean(${step(made.a)}) && Boolean(${step(made.b)})`), `the steps are drawn: ${await page.evaluate("document.querySelector('#canvas')?.innerText.slice(0, 600)")} ${page.logs().join('\n')}`);
    await page.evaluate(`(localStorage.setItem('pelago-follow', 'off'), (document.querySelector('#follow input').checked = false))`);
    await wait(800);

    // ---- A wire drawn by hand, from the edge of the first step to the second.
    const drawWire = async (from: string, to: string) => {
      const [ra, rb] = [await rect(step(from)), await rect(step(to))];
      const start: [number, number] = [ra.x + 2, ra.y + ra.h / 2];
      const end: [number, number] = [rb.x + rb.w / 2, rb.y + rb.h / 2];
      await mouse('mouseMoved', start, 0);
      assert.equal(await page.evaluate(`document.querySelector('#canvas .lens-view').dataset.wire`), 'edge', 'the pointer on the edge says a press there draws a wire');
      await mouse('mousePressed', start);
      for (let k = 1; k <= 10; k++) (await mouse('mouseMoved', [start[0] + ((end[0] - start[0]) * k) / 10, start[1] + ((end[1] - start[1]) * k) / 10]), await wait(20));
      assert.ok(await page.evaluate(`Boolean(document.querySelector('#canvas .wire-draft.onto'))`), 'the line follows the pointer, solid over a step it can end on');
      await mouse('mouseReleased', end, 0);
      return ra;
    };
    const before = await drawWire(made.a, made.b);
    assert.ok(await until(`Boolean(document.querySelector('dialog.ask .ask-choices'))`, 5000), `asked which link: ${await probe()}`);
    assert.ok(!(await page.evaluate<boolean>(`Boolean(document.querySelector('#canvas .wire-draft'))`)), 'the line is gone once let go');
    const after = await rect(step(made.a));
    assert.ok(Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1, 'a wire does not move the step it starts on');
    assert.ok(await choose(/^depends on$/), `"depends on" is offered: ${await probe()}`);
    assert.ok(await until(`Boolean(document.querySelector('#canvas svg[role=img] .lf-wire.held.mine'))`, 3000), `drawn at once as pending: ${await probe()}`);
    assert.ok(await linked(made.a, `depends_on ${made.b}`), 'a link, made through change');
    assert.ok(await until(`document.querySelectorAll('#canvas svg[role=img] .lf-wire').length === 1 && !document.querySelector('#canvas svg[role=img] .held')`), `drawn as it is once its fact arrives: ${await probe()}`);

    // ---- One refused is taken back.
    await page.evaluate(`(() => { const was = window.fetch; window.fetch = (url, init) => String(url).endsWith('/api/change') ? Promise.resolve(new Response(JSON.stringify({ error: 'refused for the test' }), { status: 400 })) : was(url, init); window.unrefuse = () => (window.fetch = was); })()`);
    await drawWire(made.d, made.b);
    assert.ok(await until(`Boolean(document.querySelector('dialog.ask .ask-choices'))`, 5000), 'asked again');
    assert.ok(await choose(/^depends on$/));
    assert.ok(await until(`/refused for the test/.test(document.querySelector('dialog.ask')?.textContent ?? '')`, 5000), `the refusal is said: ${await probe()}`);
    assert.ok(!(await page.evaluate<boolean>(`Boolean(document.querySelector('#canvas svg[role=img] .held'))`)), `taken back: ${await probe()}`);
    await page.evaluate(`(window.unrefuse(), document.querySelector('dialog.ask button').click())`);
    assert.ok(!(await links(made.d)).some((l) => l.startsWith('depends_on')), 'nothing made');

    // ---- An agent's held link, drawn dashed where it would land, applied there.
    const held = (await call('/agent/change', undefined, { actor: 'robot', reason: 'held link test', ops: [{ op: 'link', type: 'depends_on', from: made.d, to: made.b }] })).result;
    assert.ok(held.proposal, 'the agent’s link waits for the owner');
    const badge = (words: string) => `[...document.querySelectorAll('#canvas .lf-held')].find((g) => g.querySelector('title')?.textContent.includes(${JSON.stringify(words)}))`;
    assert.ok(await until(`Boolean(document.querySelector('#canvas svg[role=img] .lf-wire.held:not(.mine)')) && Boolean(${badge('held link test')})`), `drawn dashed, with its badge: ${await probe()}`);
    assert.ok(!(await links(made.d)).some((l) => l.startsWith('depends_on')), 'not yet on the map');
    const at = await rect(badge('held link test'));
    await click([at.x + at.w / 2, at.y + at.h / 2]);
    assert.ok(await until(`/Apply/.test(document.querySelector('dialog.ask')?.textContent ?? '')`, 5000), `the change is put to the person: ${await probe()}`);
    assert.ok(await choose(/^Apply$/));
    assert.ok(await until(`!document.querySelector('#canvas svg[role=img] .held') && document.querySelectorAll('#canvas svg[role=img] .lf-wire').length === 2`), `applied in place, drawn as it is: ${await probe()}`);
    assert.ok((await links(made.d)).includes(`depends_on ${made.b}`), 'on the map');
    assert.ok((await call('/api/proposals', undefined, { status: 'approved' })).result.some((p: { id: string }) => p.id === held.proposal), 'approved through decide');

    // ---- An agent's held item, a faint step where it would land, declined there.
    await call('/agent/change', undefined, { actor: 'robot', reason: 'held item test', ops: [{ op: 'create', ref: 'e', type: 'work.task', title: 'Proposed step' }, { op: 'link', type: 'part_of', from: 'e', to: made.p }] });
    assert.ok(await until(`[...document.querySelectorAll('#canvas .lf-step.ghost')].some((g) => g.textContent.includes('Proposed step')) && Boolean(${badge('held item test')})`), `a faint step: ${await probe()}`);
    const ghostAt = await rect(badge('held item test'));
    await click([ghostAt.x + ghostAt.w / 2, ghostAt.y + ghostAt.h / 2]);
    assert.ok(await until(`/Decline/.test(document.querySelector('dialog.ask')?.textContent ?? '')`, 5000));
    assert.ok(await choose(/^Decline$/));
    assert.ok(await until(`Boolean(document.querySelector('dialog.ask textarea'))`, 5000), 'asked why, as Home asks');
    await page.evaluate(`[...document.querySelectorAll('dialog.ask button')].find((b) => b.textContent === 'Decline').click()`);
    assert.ok(await until(`!document.querySelector('#canvas .lf-step.ghost') && !document.querySelector('#canvas .lf-held')`), `declined, gone: ${await probe()}`);
    assert.equal((await call('/api/proposals', undefined, {})).result.length, 0, 'nothing waits');
  } finally {
    page.close();
  }
});
