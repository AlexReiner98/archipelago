// Traces in a real browser (skipped where there is no Chrome): an agent's change reaches a page left open, and the
// row it touched is traced in the session's hue, saying who and why through the page's tip; out of sight it stays,
// in sight a moment it clears, and a reload does not bring it back (ui/traces.js).

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
    await page.evaluate(`${row}.closest('.pane').hidden = true`);
    await change([{ op: 'update', id: made.a, status: 'doing' }], { run: session.run, reason: 'Started on the tail. The rest is detail.', authority: { of: 'agent' } });
    // Waited for whole: a drawing may put a new row in its place between a wait and a read, traced a moment later.
    const line = `Session ${session.name}, doing: Started on the tail`;
    const ready = await page.until(`${row}?.classList.contains('traced') && ${row}.dataset.trace === ${JSON.stringify(line)} && /^#/.test(${row}.style.getPropertyValue('--trace-hue'))`);
    const traced = await page.evaluate<{ line: string; hue: string }>(`({ line: ${row}?.dataset.trace, hue: ${row}?.style.getPropertyValue('--trace-hue') })`);
    assert.ok(ready, `the row is traced with who, what and why, in a line: ${JSON.stringify(traced)}`);
    assert.equal(traced.line, line, 'who, what and why, in a line');
    assert.match(traced.hue, /^#[0-9a-f]{6}$/i, "in the session's hue");
    // About time passing: a mark is seen after its moment in sight (the style's trace_seen_after), and a hidden pane's
    // moment never comes. It is given well past that moment.
    await wait(2500);
    assert.ok(await page.evaluate(`${row}.classList.contains('traced')`), 'a hidden pane never counts as seen');
    await page.evaluate(`${row}.closest('.pane').hidden = false`);
    // Over the row, the page's one tip says the trace.
    await page.evaluate(`${row}.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))`);
    assert.equal(await page.evaluate(`document.querySelector('.tip')?.textContent`), traced.line, 'the tip says who and why');
    assert.ok(await page.until(`!${row}.classList.contains('traced')`, 6000), 'in sight a moment, it clears');
    const kept = await page.evaluate<string>(`localStorage.getItem('pelago-traces-default')`);
    assert.ok(Object.keys(JSON.parse(kept).seen).some((k) => k.startsWith(made.a)), 'kept as seen in this browser');
    await page.evaluate(`location.reload()`);
    assert.ok(await page.until(`Boolean(${row})`), 'drawn again');
    // About time passing as above: a reload is given past the moment in which it would (wrongly) trace it again.
    await wait(1000);
    assert.ok(!(await page.evaluate(`${row}.classList.contains('traced')`)), 'a reload does not bring it back');
  } finally {
    await page.close();
  }
});
