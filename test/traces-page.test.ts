// Traces in a real browser (skipped where there is no Chrome): an agent's change reaches a page left open, and the
// row it touched is traced in the session's hue, saying who and why through the page's tip; out of sight it stays,
// in sight a moment it clears, and a reload does not bring it back (the catch_up pack's part catch_up.changes, and
// the trace mark it answers with).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, wait } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test("in a browser, an agent's change is traced in its session's hue and clears once seen", { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  await call('/api/workspace_set', undefined, { agent_changes: 'apply' });
  const agent = async (tool: string, body: unknown) => (await (await fetch(`${base}/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as any;
  const change = async (ops: unknown[], extra: Record<string, unknown> = {}) => {
    const res = await agent('change', { reason: 'test', ...extra, ops });
    assert.equal(res.result?.status, 'applied', JSON.stringify(res));
    return res.result.created as Record<string, string>;
  };
  const made = await change([
    { op: 'create', ref: 'p', type: 'task', title: 'Traced' },
    { op: 'create', ref: 'a', type: 'task', title: 'Tail the log' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
  ]);
  const { result: session } = await agent('capture', { action: 'session_start', params: { title: 'Tracer' } });
  const page = await open(`${base}/#/e/${made.p}`);
  const row = `document.querySelector('#canvas a[href="#/e/${made.a}"]')`;
  try {
    assert.ok(await page.until(`Boolean(${row})`), 'the task is on the canvas');
    assert.ok(await page.until(`[...document.querySelectorAll('#canvas .lens-wrap')].some((w) => w.store)`), 'held in a store');
    // Out of sight: the pane is hidden while the change lands.
    await page.evaluate(`${row}.closest('.pm-pane').hidden = true`);
    await change([{ op: 'update', id: made.a, status: 'doing' }], { run: session.run, reason: 'Started on the tail. The rest is detail.', authority: { of: 'agent' } });
    // Waited for whole: a drawing may put a new row in its place between a wait and a read, traced a moment later.
    const line = `Session ${session.name}, doing: Started on the tail`;
    // Checked in the one read that waits: a read after it may meet the row a redraw has just put in its place.
    const ready = await page.until(`${row}?.classList.contains('traced') && ${row}.dataset.trace === ${JSON.stringify(line)} && /^#[0-9a-f]{6}$/i.test(${row}.style.getPropertyValue('--trace-hue'))`);
    if (!ready) assert.fail(`the row is traced with who, what and why, in a line, in the session's hue: ${JSON.stringify(await page.evaluate(`({ line: ${row}?.dataset.trace, hue: ${row}?.style.getPropertyValue('--trace-hue') })`))}`);
    // About time passing: a mark is seen after its moment in sight (the style's trace_seen_after), and a hidden pane's
    // moment never comes. It is given well past that moment.
    await wait(2500);
    // Each read of the row waits for it: a redraw may have it gone a moment.
    assert.ok(await page.until(`${row}?.classList.contains('traced') === true`), 'a hidden pane never counts as seen');
    await page.until(`Boolean(${row}) && ((${row}.closest('.pm-pane').hidden = false), true)`);
    // Over the row, the page's one tip says the trace.
    await page.until(`Boolean(${row}) && (${row}.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })), true)`);
    // The tip is drawn after the hover is handled, perhaps a frame later: waited for, and compared with the line itself,
    // not with a read of the row, which a redraw may have replaced between the wait above and that read.
    const tipped = await page.until(`document.querySelector('.tip')?.textContent === ${JSON.stringify(line)}`);
    assert.ok(tipped, `the tip says who and why: ${await page.evaluate(`document.querySelector('.tip')?.textContent`)}`);
    assert.ok(await page.until(`${row}?.classList.contains('traced') === false`, 6000), 'in sight a moment, it clears');
    // What the traces part keeps, under its own name in this workspace (tools.keep: packs/surface/page/part-host.js).
    const kept = await page.evaluate<string>(`localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('pelago-part:catch_up.changes:') && k.endsWith(':traces')) ?? '')`);
    assert.ok(Object.keys(JSON.parse(kept).seen).some((k) => k.startsWith(made.a)), 'kept as seen in this browser');
    await page.evaluate(`location.reload()`);
    assert.ok(await page.until(`Boolean(${row})`), 'drawn again');
    // About time passing as above: a reload is given past the moment in which it would (wrongly) trace it again.
    await wait(1000);
    assert.ok(await page.until(`${row}?.classList.contains('traced') === false`), 'a reload does not bring it back');
  } finally {
    await page.close();
  }
});
