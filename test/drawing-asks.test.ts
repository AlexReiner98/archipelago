// A drawing asks in data; the page acts as the person (decision e_h7he5guk, src/drawing-changes.ts). In a real
// browser: a style's code puts a text field over its canvas, the person fills it in, the code hears only the value,
// and the change it asks for is sent as the person, applied for a type its style writes and held for one it does not.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CODE = `export default function draw({ field, change, on }) {
  const at = { x: 20, y: 20, width: 240, height: 30, placeholder: 'Name' };
  field('name', at);
  // What it made comes back in its answer: shown in a field of its own.
  on('answer', (next) => next.items.some((i) => i.title === 'Typed task') && field('seen', { x: 20, y: 60, width: 240, height: 30, value: 'seen' }));
  on('field', async ({ value, done }) => {
    if (!done) return;
    const mine = await change([{ op: 'create', type: 'work.task', title: value }], 'Typed in the drawing');
    const other = await change([{ op: 'create', type: 'work.note', title: 'Not its to write' }], 'Asked by the drawing');
    field('name', { ...at, value: [mine.status, other.status, other.held ? 'held' : ''].join(' ') });
  });
}`;

test('in a browser, a drawing gets a text field and asks for changes, which the page sends as the person', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work.task', title: 'Seed' },
      { op: 'create', ref: 'c', type: 'lens', title: 'Asked', status: 'current', props: { filter: { types: ['work.task'] } } },
      { op: 'create', ref: 's', type: 'style', title: 'Asking', status: 'current', props: { code: CODE, writes: ['work.task'] } },
      { op: 'link', type: 'about', from: 's', to: 'c' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?canvas=${made.c}`);
  try {
    // The sandboxed frame runs in a process of its own (Chrome isolates them): reached through a session of its own.
    await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    // Two frames load draw.html (the one every drawing shares, and this code's own): the one with the field is this code's.
    let sessionId = '';
    const inFrame = async (expression: string, session = sessionId) => (await page.send('Runtime.evaluate', { expression, returnByValue: true }, session)).result?.result?.value;
    const tried = new Set<string>();
    for (let n = 0; n < 60 && !sessionId; n++, await wait(200)) {
      for (const t of (await page.send('Target.getTargets')).result.targetInfos as { targetId: string; type: string; url: string }[]) {
        if (t.type !== 'iframe' || !new URL(t.url).pathname.endsWith('/draw.html')) continue;
        if (!tried.has(t.targetId)) tried.add(t.targetId);
        const session = (await page.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).result.sessionId;
        if (await inFrame(`Boolean(document.querySelector('input.field'))`, session)) sessionId = session;
      }
    }
    assert.ok(sessionId, `the page drew the field the code asked for, in its frame (${tried.size} frames seen)`);
    // What a person types: the field's events, as the browser raises them.
    await inFrame(`(() => { const f = document.querySelector('input.field'); f.focus(); f.value = 'Typed task'; f.dispatchEvent(new Event('input')); f.dispatchEvent(new Event('change')); f.blur(); })()`);
    let found: { title: string }[] = [];
    for (let n = 0; n < 40 && !found.length; n++, await wait(200)) found = (await call('/api/query', undefined, { name: 'search', params: { q: 'Typed task', type: 'work.task' } })).result ?? [];
    assert.equal(found[0]?.title, 'Typed task', 'a type its style writes: applied, as the person');
    let said = '';
    for (let n = 0; n < 40 && !said; n++, await wait(200)) said = await inFrame(`(() => { return document.querySelector('input.field').value.replace('Typed task', ''); })()`);
    assert.equal(said, 'applied proposed held', 'the code is told what came of each: one applied, one held for the person');
    let seen = false;
    for (let n = 0; n < 40 && !seen; n++, await wait(200)) seen = await inFrame(`document.querySelectorAll('input.field').length === 2`);
    assert.ok(seen, 'what the code made is in the answer it is handed next');
    const pending = (await call('/api/query', undefined, { name: 'proposals' })).result;
    assert.match(JSON.stringify(pending), /drawing_reach/, 'held by the rule for what a drawing does not write');
    assert.equal(await inFrame(`document.querySelectorAll('canvas').length`), 1, 'the same frame: a new answer reached the code that listens for one, not a new picture');
  } finally {
    await page.close();
  }
});
