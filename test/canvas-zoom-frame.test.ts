// What a frame of a zoom costs, in a real browser (skipped where there is no Chrome). A drawing that changes a mark as
// the plane moves (wire names kept at their size on screen) or that plays (the reflex tree) changed one on every frame,
// and the plane then measured every mark of the picture again in that frame: each culled one drawn to be measured, the
// whole picture laid out (60 to 90 ms a frame on the islands). It measures the mark that changed, after the frame. The
// scale went on the frame, so every mark's style was worked out again each frame: it goes to what asks for it
// (`ln-plane`). And no `:has()` rule may end in what matches any element: Chrome then works out the whole page's style
// on every element added anywhere, as the edge names add theirs each frame.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a zoom after one mark changed measures that mark alone, and the frame carries no scale', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const titles = Array.from({ length: 60 }, (_, k) => `Step ${k + 1} of the order`);
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'work', title: 'Zoomed here' },
      ...titles.map((title, k) => ({ op: 'create', ref: `s${k}`, type: 'work', title })),
      ...titles.map((_, k) => ({ op: 'link', type: 'part_of', from: `s${k}`, to: 'p' })),
      ...titles.slice(1).map((_, k) => ({ op: 'link', type: 'depends_on', from: `s${k + 1}`, to: `s${k}` })),
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?from=${made.p}`);
  const step = (id: string) => `document.querySelector('#canvas svg a[href="#/e/${id}"]')`;
  const moves = `document.querySelector('#canvas .lens-view').moves`;
  const frames = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`;
  try {
    assert.ok(await page.until(`Boolean(${step(made.s59)}) && Boolean(${moves})`), `the order is drawn: ${page.logs().join('\n')}`);
    assert.ok(await page.still(`${step(made.s59)}.getBoundingClientRect()`), 'the picture stands still');
    // Zoomed in on its first step, most of it out of sight and not drawn; then let the plane settle.
    const culled = await page.evaluate<number>(`(async () => {
      const m = ${moves}, b = ${step(made.s0)}.getBBox();
      m.restore({ ...m.state(), s: 3 });
      m.show(b.x + b.width / 2, b.y + b.height / 2);
      await ${frames}; await new Promise((r) => setTimeout(r, 100)); await ${frames};
      return document.querySelectorAll('#canvas .lf-stage svg [display="none"]').length;
    })()`);
    assert.ok(culled > 10, `zoomed in, most marks are out of sight and not drawn: ${culled}`);
    // One mark changes, as a drawing that answers the plane changes one; then the plane moves a step.
    const shown = await page.evaluate<number>(`(async () => {
      const svg = document.querySelector('#canvas .lf-stage svg');
      let shown = 0;
      const seen = new MutationObserver((rs) => (shown += rs.filter((r) => r.oldValue === 'none').length));
      seen.observe(svg, { subtree: true, attributes: true, attributeFilter: ['display'], attributeOldValue: true });
      const a = ${step(made.s0)};
      a.setAttribute('transform', 'translate(0 0)');
      ${moves}.zoomBy(1.1);
      await ${frames}; await new Promise((r) => setTimeout(r, 100)); await ${frames};
      seen.disconnect();
      return shown;
    })()`);
    assert.ok(shown <= 2, `the marks out of sight stay undrawn: ${shown} drawn again to be measured`);
    assert.equal(await page.evaluate(`document.querySelector('#canvas .lf-stage').style.getPropertyValue('--ln-plane-scale')`), '', 'the scale is not given to the whole frame');
  } finally {
    await page.close();
  }
});

/** Every stylesheet of the packs, and what each holds. */
const sheets = (dir: string): [string, string][] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const at = join(dir, e.name);
    if (e.isDirectory()) return sheets(at);
    return e.name.endsWith('.css') ? [[at.split(sep).join('/'), readFileSync(at, 'utf8')] as [string, string]] : [];
  });

/** The last compound of a selector, split at its combinators outside any parentheses: what the rule styles. */
function lastCompound(sel: string): string {
  let depth = 0, from = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (!depth && /[\s>+~]/.test(c)) from = i + 1;
  }
  return sel.slice(from);
}

/** Whether a compound is named by a class, an id, a tag or an attribute (in an `:is()` or `:where()` list, each of
 * it), or is itself what `:has()` asks of: then Chrome can tell what an added element touches. A negation names nothing. */
function names(compound: string): boolean {
  if (compound.includes(':has(')) return true;
  const lists = [...compound.matchAll(/:(?:is|where)\(((?:[^()]|\([^()]*\))*)\)/g)].map((m) => m[1]);
  const own = compound.replace(/:(?:not|is|where)\((?:[^()]|\([^()]*\))*\)/g, '').replace(/::?[a-z-]+/g, '');
  if (/^[a-z]|[.#[]/i.test(own)) return true;
  return lists.length > 0 && lists.every((list) => list.split(',').every((s) => names(lastCompound(s.trim()))));
}

/** What broke the rule on 19 Nov 2026: may only shrink. A document's page, not the canvas, where nothing is added a frame. */
const KNOWN = ['packs/surface/page/doc-lens.css: body:has(> .page-land, > .page-backdrop) > :not(.page-land, .page-backdrop)'];

test('no :has() rule ends in a compound that matches any element', () => {
  assert.equal(names(lastCompound('.menu-items:has(> details.pm-menu[open]) > :not(details.pm-menu[open])')), false);
  assert.equal(names(lastCompound('.menu-items:has(> details[open]) > *')), false);
  assert.equal(names(lastCompound(':where(main:has(> nav.site-head)) :is(h1, h2)')), true);
  assert.equal(names(lastCompound('.pane-canvas:has(iframe)::after')), true);
  const found: string[] = [];
  for (const [file, text] of sheets('packs')) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selectors] of css.matchAll(/([^{}]+)\{/g)) {
      for (const sel of selectors.split(/,(?![^(]*\))/).map((s) => s.trim())) {
        if (sel.includes(':has(') && !names(lastCompound(sel))) found.push(`${file}: ${sel}`);
      }
    }
  }
  assert.deepEqual(found, KNOWN);
});
