// Shapes the kernel drew until a pack's drawing took them over: in a real browser (skipped where there is no Chrome),
// the core pack's grid and time drawings draw what the kernel's own code drew (ui/grid.js and ui/timeline.js, until
// 23 Oct 2026), kept in test/fixtures/drawings/: the same marks, every element in the same place, the same looks. A
// drawing sets no style on a mark, so what the kernel set as a style is a class of the drawing's own; those classes
// and the kernel's style attributes are left out of the comparison, and what they drew is compared as looks.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { gridCases, timeCases, type DrawingCase } from './drawing-cases.ts';
import { serve } from './serve.ts';

const browser = chrome();
const fixture = (name: string) => join(import.meta.dirname, 'fixtures', 'drawings', `${name}.kernel.${process.platform}.json`);

/** The drawing a picture kept in this shape is sent, and what it draws of each case, captured in the page. */
async function drawn(shape: string, cases: DrawingCase[]) {
  const { call, base } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 's', type: 'style', title: shape, status: 'current', props: { shape } }] })).result.created;
  const { drawing } = (await call('/api/view', undefined, { name: 'style', params: { style: made.s, have: [] } })).result.style;
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

/** Each case drawn now against what the kernel drew, or what was last kept as the drawing's own. `own` matches the drawing's own classes, `extra` its own marks. */
function same(now: Record<string, any>, kernel: string, own: RegExp, extra: string[] = [], html = (text: string) => text) {
  // A change meant to draw otherwise (the house style's text, 27 Oct 2026) keeps what it now draws, with GOLDEN_WRITE=1.
  if (process.env.GOLDEN_WRITE) return void writeFileSync(kernel, `${JSON.stringify(now)}
`);
  if (!existsSync(kernel)) return;
  const was = JSON.parse(readFileSync(kernel, 'utf8'));
  // The key is the page's now, drawn from the scene's key (docs/drawings.md), not the drawing's own marks: what is
  // compared is the picture, so each record is cut where its key starts (the last thing in a picture the page lays out).
  const keyless = (r: any) => {
    // A key the kernel drew bare (the time axis's: a div with no class) is what follows the picture's svg.
    const named = r.html.search(/<div class="([^"]* )?(lg-legend|t-key|lf-legend)[ "]/), after = r.html.indexOf('</svg><div');
    const start = named >= 0 ? named : after >= 0 ? after + '</svg>'.length : -1;
    if (start < 0) return r;
    // The elements before it, in the order the records list them (each opening tag is one).
    const at = (r.html.slice(0, start).match(/<[a-zA-Z]/g) ?? []).length;
    const cut = (list: any[] | undefined) => list?.slice(0, at);
    return { ...r, html: r.html.slice(0, start), ...(r.classes && { classes: cut(r.classes) }), boxes: cut(r.boxes), styles: cut(r.styles) };
  };
  for (const name of Object.keys(was)) (was[name] = keyless(was[name])), now[name] && (now[name] = keyless(now[name]));
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
    // An element with no size (a title, what is hidden) is nowhere: where the page puts the host says where it is reported.
    const at = (r: any, k: number) => (/ 0 0$/.test(r.boxes[k]) ? 'no size' : r.boxes[k]);
    assert.deepEqual(kept(b).map((k: number) => at(b, k)), kept(a).map((k: number) => at(a, k)), `${name}: where each is`);
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
  same(await drawn('time', timeCases()), fixture('time'), /^t-(key|hued|h-)/, [], (text) => text.replaceAll(' tabindex="0"', '').replaceAll('></line>false<', '></line><'));
});
