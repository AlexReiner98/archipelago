// How an item is drawn, as six slots a style sets (round 6, screen e_fgdwazkw): outline (`type_shapes`, in ./index.js),
// ink (`item_ink`), fill (`item_fill`), state (`item_state`), mark (`item_marks`) and text (`item_text`). A pack claims a
// slot for its own type in its preset; a type it does not name falls back to its starter's (`lineageOf`). Only the colour
// roles the page has (land, sea, text, line, muted, you): the looks differ by form, never by a new hue. Every length is the
// style's (sizes, read as --ln-flow-*). Layer: marks. Pure: a style in, css and marks out.

import { lineageOf } from './graph.js';

const words = (v) => String(v ?? '').split(/\s+/).filter(Boolean);
const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const one = (v, from, none) => (from.includes(String(v)) ? String(v) : none);
const PLAIN = ':not(.you):not(.here):not(.focus):not(.ghost):not(.held):not(.waiting)';

/** What a style says of the six slots (the outline is `type_shapes`, read by ./steps.js). */
export function grammar(style) {
  const state = new Set(words(style.item_state)), text = record(style.item_text);
  // Round 5 gave the fill words to the state: still read, where `item_fill` says nothing.
  const fill = one(style.item_fill, ['card', 'lift', 'stratum', 'none'], state.has('lift') ? 'lift' : state.has('land') ? 'none' : null);
  return {
    ink: one(style.item_ink, ['line', 'ink'], 'line'), fill, state,
    marks: record(style.item_marks), text: { face: one(text.face, ['body', 'display'], 'body'), weight: one(text.weight, ['phase', 'even'], null) },
    // The state is said once, on the shape: the dot before the title stays only where the style asks for no other say.
    dot: !['double', 'foot', 'notch'].some((w) => state.has(w)),
    // A check where there is no notch for it keeps the dot's room before the name, empty until the item is finished.
    tick: state.has('check') && (state.has('foot') || state.has('double')) && !state.has('notch'),
  };
}

/** The glyph of an item's type, else its nearest flavour's that has one (a pack claims it for its own type), if any. */
export const glyphOf = (g, item) => ((own) => (own ? String(g.marks[own]) : null))(lineageOf(item).find((t) => typeof g.marks[t] === 'string' && g.marks[t]));

/** The css of the six slots, over the house look in ./look.js. A step that waits on you, is open, a focus, held or waiting keeps its own colours. */
export function itemRules(style) {
  const g = grammar(style), s = g.state, rules = [];
  const shape = (sel, body) => rules.push(`.lf-step${sel} .lf-shape { ${body} }`);
  if (g.ink === 'ink') {
    rules.push('.lf-step { --lf-ink: light-dark(var(--ln-text), var(--ln-sea)); }');
    shape(`${PLAIN}:not(.closed)`, 'stroke: var(--lf-ink); stroke-width: var(--ln-flow-stroke-ink, var(--ln-flow-stroke-lit));');
  } else rules.push('.lf-step { --lf-ink: var(--ln-text); }');
  if (g.fill) {
    const fills = { card: 'var(--ln-land)', none: 'none', lift: 'color-mix(in srgb, var(--ln-text) var(--ln-flow-item-lift), var(--ln-land))', stratum: 'color-mix(in srgb, var(--ln-text) var(--ln-flow-item-lift), var(--ln-land))' };
    shape(PLAIN, `fill: ${fills[g.fill]};`);
    // A stratum is a slab lifted off its land, its edge the ink; what is finished sinks to the land, outline only.
    if (g.fill === 'stratum') {
      rules.push('.lf-step .lf-slab { fill: var(--lf-ink); stroke: var(--lf-ink); stroke-width: var(--ln-flow-stroke); pointer-events: none; }');
      shape(`.ph-finished${PLAIN}`, 'fill: none;'); shape(`.ph-ended${PLAIN}`, 'fill: none;');
    }
  }
  if (s.has('weight')) {
    shape(`.ph-under_way${PLAIN}`, 'stroke: var(--ln-text); stroke-width: var(--ln-flow-stroke-lit);');
    shape(`.ph-finished${PLAIN}`, 'fill: none; stroke-width: var(--ln-rule);');
    shape(`.ph-ended${PLAIN}`, 'fill: none; stroke-width: var(--ln-rule);');
    shape(`.ph-not_started${PLAIN}`, 'stroke: var(--ln-muted); stroke-width: var(--ln-rule);');
  }
  if (s.has('double')) {
    shape(`.ph-not_started${PLAIN}`, 'stroke: var(--ln-muted); stroke-width: var(--ln-rule);');
    shape(`.ph-under_way${PLAIN}`, 'stroke: var(--lf-ink); stroke-width: var(--ln-flow-stroke);');
    shape(`.ph-finished${PLAIN}`, 'stroke: var(--lf-ink); stroke-width: var(--ln-flow-stroke-lit);');
    rules.push('.lf-step .lf-inner { fill: none; stroke: var(--lf-ink); stroke-width: var(--ln-flow-stroke); pointer-events: none; }');
  }
  if (s.has('foot')) rules.push('.lf-foot { fill: none; stroke: var(--ln-text); stroke-width: var(--ln-flow-foot); pointer-events: none; }');
  if (s.has('notch')) {
    rules.push('.lf-notch { fill: none; stroke: var(--lf-ink); stroke-width: var(--ln-rule); pointer-events: none; }');
    rules.push('.lf-notch.ph-under_way, .lf-notch.ph-trouble { fill: var(--lf-ink); } .lf-notch.ph-trouble { stroke: var(--ln-blocked); fill: var(--ln-blocked); }');
  }
  if (s.has('check')) {
    rules.push('.lf-dot-check { fill: none; stroke: var(--ln-land); stroke-width: var(--ln-flow-stroke); stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }');
    rules.push('.lf-tick { fill: none; stroke: var(--lf-ink); stroke-width: var(--ln-flow-stroke-lit); stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }');
  }
  if (Object.keys(g.marks).length) rules.push('.lf-step .lf-glyph { fill: var(--ln-muted); font-size: var(--ln-flow-glyph-text); font-family: var(--ln-font); text-anchor: end; dominant-baseline: middle; pointer-events: none; }');
  if (g.text.face === 'display') rules.push('.lf-step text { font-family: var(--type-heading-family, var(--face-chart, var(--ln-font))); font-weight: var(--type-heading-weight, 400); }');
  if (g.text.weight === 'phase') {
    rules.push('.lf-step.ph-under_way text { font-weight: 700; } .lf-step.ph-not_started text { font-weight: 400; }');
    rules.push('.lf-step.ph-finished text, .lf-step.ph-ended text { font-weight: 400; fill: var(--ln-muted); }');
  } else if (g.text.weight === 'even') rules.push('.lf-step text { font-weight: 400; }');
  return rules.join('\n');
}

const tickPath = (cx, cy, r) => `M${cx - r * 0.5} ${cy + r * 0.05}L${cx - r * 0.12} ${cy + r * 0.42}L${cx + r * 0.52} ${cy - r * 0.4}`;

/**
 * The marks an item has besides its outline: what lies under it (a stratum's slab), what lies over it (the second line,
 * the foot, the notch, a check, the glyph). `at` is its middle and `n` its step (w, h, shape, bevel); `z` the style's
 * sizes by name, `outline` the drawing of its outline, `m` the mark maker. A style that asks for none gives none.
 */
export function itemMarks({ g, n, at: [X, Y], phase, item, z, outline, m, corner, dotAt }) {
  const l = X - n.w / 2, r = X + n.w / 2, t = Y - n.h / 2, b = Y + n.h / 2, ended = phase === 'finished' || phase === 'ended';
  const bevel = n.bevel ?? 0, round = n.shape === 'pill' ? n.h / 2 : bevel, out = { under: [], over: [] };
  if (g.fill === 'stratum' && !ended) out.under.push(addClass(outline(n.shape, X, Y + z('slab'), n.w, n.h, corner, n.bevel), 'lf-slab'));
  if (g.state.has('double') && phase === 'under_way') {
    const gap = z('double_gap');
    out.over.push(addClass(outline(n.shape, X, Y, n.w - 2 * gap, n.h - 2 * gap, Math.max(0, corner - gap), n.bevel && Math.max(0, n.bevel - gap)), 'lf-inner'));
  }
  if (g.state.has('foot') && phase === 'under_way') {
    const inset = n.shape === 'diamond' ? n.w / 4 : round + corner, y = n.shape === 'diamond' ? Y + n.h / 4 : b - z('foot') / 2;
    out.over.push(m('path', { d: `M${l + inset} ${y}H${r - inset}`, class: 'lf-foot' }));
  }
  if (g.state.has('notch') && phase !== 'standing') {
    const s = z('notch_size'), x0 = n.shape === 'diamond' ? X : l + (n.shape === 'box' || n.shape === 'tab' || n.shape === 'sheet' || n.shape === 'flag' ? 0 : round);
    const y0 = n.shape === 'tab' ? t + bevel : t;
    out.over.push(ended && g.state.has('check')
      ? m('path', { d: tickPath(x0 + s * 0.5, y0 + s * 0.55, s * 0.75), class: 'lf-tick' })
      : m('path', { d: `M${x0} ${y0}H${x0 + s}L${x0} ${y0 + s}Z`, class: `lf-notch ph-${phase}` }));
  } else if (g.tick && ended) out.over.push(m('path', { d: tickPath(dotAt[0], dotAt[1], z('dot')), class: 'lf-tick' }));
  const glyph = glyphOf(g, item);
  if (glyph) out.over.push(m('text', { x: r - z('glyph_inset') - round / 2, y: t + z('glyph_drop'), class: 'lf-glyph' }, glyph));
  return out;
}

/** A mark with a class added to the ones it has. */
function addClass(mark, cls) {
  if (mark?.[1]) mark[1].class = `${mark[1].class ?? ''} ${cls}`.trim();
  return mark;
}
