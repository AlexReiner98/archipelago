// Shapes the kernel drew until a pack's drawing took them over: in a real browser (skipped where there is no Chrome),
// the core pack's grid and time drawings draw what the kernel's own code drew (ui/grid.js and ui/timeline.js, until
// 23 Oct 2026), kept in test/fixtures/drawings/: the same marks, every element in the same place, the same looks. A
// drawing sets no style on a mark, so what the kernel set as a style is a class of the drawing's own; those classes
// and the kernel's style attributes are left out of the comparison, and what they drew is compared as looks.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { gridCases, timeCases, type DrawingCase } from './drawing-cases.ts';
import { serve } from './serve.ts';

const browser = chrome();
const fixture = (name: string) => join(import.meta.dirname, 'fixtures', 'drawings', `${name}.kernel.${process.platform}.json`);

/** The drawing a picture kept in this shape is sent, and what it draws of each case, captured in the page. */
async function drawn(shape: string, cases: DrawingCase[], lens: Record<string, unknown> = {}) {
  const { call, base } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'p', type: 'work.project', title: 'A plan' }, { op: 'create', ref: 'l', type: 'lens', title: `As ${shape}`, status: 'current', props: lens }, { op: 'link', type: 'about', from: 'l', to: 'p' }, { op: 'create', ref: 's', type: 'style', title: shape, status: 'current', props: { shape } }, { op: 'link', type: 'about', from: 's', to: 'l' }] })).result.created;
  const { drawing } = (await call('/api/view', undefined, { name: 'lens', params: { from: made.p, lens: made.l } })).result.style;
  assert.equal(drawing.id, `core.${shape}`);
  const page = await open(`${base}/`);
  try {
    await page.evaluate(readFileSync(join(import.meta.dirname, 'drawing-capture.js'), 'utf8'));
    // The page's registry is loaded, so a card's colour follows the order its type declares.
    await page.evaluate(`new Promise((r) => setTimeout(r, 1500))`);
    const sent = cases.map((c) => ({ ...c, style: { ...c.style, drawing } }));
    return (await page.evaluate(`(async () => { const { drawWith } = await import('/drawing.js'); return captureDrawings(drawWith, ${JSON.stringify(sent)}); })()`)) as Record<string, any>;
  } finally {
    page.close();
  }
}

/** Each case drawn now against what the kernel drew. `own` matches the drawing's own classes, `extra` its own marks. */
function same(now: Record<string, any>, kernel: string, own: RegExp, extra: string[] = [], html = (text: string) => text) {
  if (!existsSync(kernel)) return;
  const was = JSON.parse(readFileSync(kernel, 'utf8'));
  const marks = (text: string) =>
    html(text)
      .replace(/ style="[^"]*"/g, '')
      .replace(/ class="([^"]*)"/g, (_, c: string) => {
        const kept = c.split(' ').filter((k) => k && !own.test(k));
        return kept.length ? ` class="${kept.join(' ')}"` : '';
      });
  const kept = (r: any) => (r.classes ?? r.boxes.map(() => '')).map((c: string, k: number) => [c, k]).filter(([c]: [string]) => !c.split(' ').some((k) => extra.includes(k))).map(([, k]: [string, number]) => k);
  for (const name of Object.keys(was)) {
    const [a, b] = [was[name], now[name]];
    assert.ok(b, `${name} is drawn`);
    assert.equal(marks(b.html), marks(a.html), `${name}: the marks`);
    assert.deepEqual(kept(b).map((k: number) => b.boxes[k]), kept(a).map((k: number) => a.boxes[k]), `${name}: where each is`);
    assert.deepEqual(kept(b).map((k: number) => b.looks[b.styles[k]]), kept(a).map((k: number) => a.looks[a.styles[k]]), `${name}: the looks`);
  }
}

test('in a browser, the grid drawing draws what the kernel drew: the same cards, rows, lanes, places and looks', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  // A colour and the columns are classes; a swatch's chip is a mark, where the kernel drew it as ::before.
  same(await drawn('grid', gridCases()), fixture('grid'), /^lg-(h|c)-/, ['lg-chip'], (text) => text.replace(/<span class="lg-chip"><\/span>/g, ''));
});

test('in a browser, the time drawing draws what the kernel drew: the same days, hours, lanes, blocks, places and looks', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  // A colour and the key are classes; a block opens its item through the drawing, so it is not a tab stop of its own;
  // and the kernel left the word "false" after its last hour line, as text an SVG does not draw.
  same(await drawn('time', timeCases(), { time: { from: '2026-11-02', to: '2026-11-08' } }), fixture('time'), /^t-(key|hued|h-)/, [], (text) => text.replaceAll(' tabindex="0"', '').replaceAll('></line>false<', '></line><'));
});
