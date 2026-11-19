// How an item is drawn, as six slots a style sets (round 6, screen e_fgdwazkw): outline (`type_shapes`, in ./index.js),
// ink (`item_ink`), fill (`item_fill`), state (`item_state`), mark (`item_marks`) and text (`item_text`). A pack claims a
// slot for its own type in its preset; a type it does not name falls back to its starter's (`lineageOf`). Only the colour
// roles the page has (land, sea, text, line, muted, you): the looks differ by form, never by a new hue. Every length is the
// style's (sizes, read as --ln-flow-*). Layer: marks. Pure: a style in, css and marks out.

import { lineageOf } from './graph.js';
import { colourWays, ridgeMarks } from './ridge-item.js';
import { cutPath, depthFor } from './cut-item.js';
import { seedOf } from './ridge-item.js';

const words = (v) => String(v ?? '').split(/\s+/).filter(Boolean);
const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const one = (v, from, none) => (from.includes(String(v)) ? String(v) : none);
const PLAIN = ':not(.you):not(.here):not(.focus):not(.ghost):not(.held):not(.waiting)';

/** The ridge a style asks for: its state option, its palette's colours (none: the island's hue), the forms by type and by name. */
const ridgeOf = (style) => (['bands', 'emerge'].includes(style.ridge_state) ? { mode: style.ridge_state, ways: colourWays(record(style.ridge_palettes)[style.ridge_palette] ?? Object.values(record(style.ridge_palettes))[0]), island: !record(style.ridge_palettes)[style.ridge_palette], types: record(style.type_forms), forms: record(style.ridge_forms) } : null);

/** The cut a style asks for: the accent of each phase, the cut of each type, and the dials (depth, softness, room above the name, whether it grows with progress). */
const cutOf = (style) => (Object.keys(record(style.cut_colours)).length && Number(style.cut_depth) > 0 ? { colours: record(style.cut_colours), types: record(style.type_cuts), depth: Number(style.cut_depth), soft: Number(style.cut_soft), clear: Number(style.cut_clear) || 0, grow: style.cut_grow === true } : null);

/** What a style says of the six slots (the outline is `type_shapes`, read by ./steps.js). */
export function grammar(style) {
  const state = new Set(words(style.item_state)), text = record(style.item_text);
  // Round 5 gave the fill words to the state: still read, where `item_fill` says nothing.
  const fill = one(style.item_fill, ['card', 'lift', 'stratum', 'none', 'clear', 'terrace'], state.has('lift') ? 'lift' : state.has('land') ? 'none' : null);
  return {
    ink: one(style.item_ink, ['line', 'ink', 'skyline'], 'line'), fill, state,
    marks: record(style.item_marks), text: { face: one(text.face, ['body', 'display'], 'body'), weight: one(text.weight, ['phase', 'even'], null) },
    // The state is said once, on the shape: the dot before the title stays only where the style asks for no other say.
    // A ridge says the state itself, in its colours: its palette's, by name, and the form each type stands in.
    ridge: ridgeOf(style), cut: cutOf(style),
    dot: !ridgeOf(style) && !cutOf(style) && fill !== 'terrace' && !['double', 'foot', 'notch'].some((w) => state.has(w)),
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
  } else if (g.ink === 'skyline') {
    // The item's top is inked and its sides a hairline: the top edge is a mark of its own (itemMarks).
    rules.push('.lf-step { --lf-ink: var(--ln-text); }', '.lf-skyline { fill: none; stroke: var(--lf-ink); stroke-width: var(--ln-flow-stroke-ink); stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }');
    shape(`${PLAIN}:not(.closed)`, 'stroke-width: var(--ln-rule);');
  } else rules.push('.lf-step { --lf-ink: var(--ln-text); }');
  if (g.fill) {
    // clear: the item knocks out the rows under it, as the wordmark's plate does; terrace: on steps in its island's hue.
    const fills = { card: 'var(--ln-land)', none: 'none', clear: 'var(--ln-sea)', terrace: 'var(--ln-land)', lift: 'color-mix(in srgb, var(--ln-text) var(--ln-flow-item-lift), var(--ln-land))', stratum: 'color-mix(in srgb, var(--ln-text) var(--ln-flow-item-lift), var(--ln-land))' };
    shape(PLAIN, `fill: ${fills[g.fill]};`);
    if (g.fill === 'terrace') rules.push('.lf-tstep { stroke: none; pointer-events: none; } .lf-tstep-1 { fill: color-mix(in srgb, var(--lf-island, var(--ln-text)) var(--ln-flow-terrace-mix-1), var(--ln-sea)); } .lf-tstep-2 { fill: color-mix(in srgb, var(--lf-island, var(--ln-text)) var(--ln-flow-terrace-mix-2), var(--ln-sea)); } .lf-tstep-3 { fill: color-mix(in srgb, var(--lf-island, var(--ln-text)) var(--ln-flow-terrace-mix-3), var(--ln-sea)); }');
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
  if (g.cut) rules.push('.lf-step .lf-cut { stroke: none; pointer-events: none; } .lf-step .lf-cut-none { fill: var(--ln-muted); } .lf-step .lf-cut-trouble { fill: var(--ln-blocked); } .lf-step.you .lf-cut { fill: var(--ln-you); }');
  if (g.ridge) {
    rules.push('.lf-step .lf-ridge { stroke: none; pointer-events: none; } .lf-step .lf-ridge-ink { fill: none; stroke: var(--lf-ink, var(--ln-text)); stroke-width: var(--ln-flow-ridge-ink); stroke-linejoin: round; pointer-events: none; } .lf-step .lf-rc-island { fill: var(--lf-island, var(--ln-text)); }');
    // The step's outline is the mountain's ink and its ground line, and its name: what hover, here, focus and you light.
    rules.push('.lf-step.ridged text { text-anchor: middle; } .lf-step.ridged .lf-shape { fill: none; }');
    shape(`.ridged${PLAIN}`, 'stroke: var(--ln-line); stroke-width: var(--ln-flow-stroke);');
    rules.push('.lf-step.ridged:is(:hover, :focus) .lf-ridge-ink { stroke: var(--ln-text); stroke-width: var(--ln-flow-stroke-lit); } .lf-step.ridged:is(:hover, :focus) text { font-weight: 700; }');
    rules.push('.lf-step.ridged.you .lf-ridge-ink { stroke: var(--ln-you); stroke-width: var(--ln-flow-stroke-lit); } .lf-step.ridged.you text { fill: var(--ln-you); }');
    rules.push('.lf-step.ridged.here .lf-ridge-ink { stroke: var(--accent, var(--ln-text)); stroke-width: var(--ln-flow-stroke-lit); } .lf-step.ridged.here text { fill: var(--accent, var(--ln-text)); }');
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
  if (g.fill === 'terrace') {
    // One step under it not started, two under way, three finished: the steps are its phase, each narrower than the one above.
    const levels = ['not_started', 'under_way', 'finished'], k = ended ? levels.length : Math.max(1, levels.indexOf(phase) + 1), hs = z('terrace_item'), inset = z('terrace_item_in');
    for (let j = 0; j < k; j++) out.under.push(m('rect', { class: `lf-tstep lf-tstep-${levels.length - j}`, x: l + (j + 1) * inset, y: b + j * hs - 1, width: Math.max(0, n.w - 2 * (j + 1) * inset), height: hs }));
  }
  if (g.ink === 'skyline') out.over.push(m('path', { class: 'lf-skyline', d: skyline(n, X, Y, round) }));
  if (g.ridge && n.shape === 'ridge') {
    // No box: the mountain stands on its ground line, which is the middle of the step (wires land on its ends), the name under it.
    const form = ((own) => g.ridge.forms[own] ?? Object.values(g.ridge.forms)[0] ?? {})(lineageOf(item).map((t) => g.ridge.types[t]).find(Boolean));
    const made = ridgeMarks({ id: item.id, x0: l + z('ridge_side'), x1: r - z('ridge_side'), base: Y, hgt: z('ridge_rise'), form, phase, mode: g.ridge.mode, ways: g.ridge.ways, island: g.ridge.island, m, cols: z('ridge_cols') });
    out.over.push(...made.marks);
    out.rules = made.rules;
  }
  if (g.cut && n.shape === 'carved') {
    // The cut off a corner or an edge, in the accent of the item's phase: the phase's colour, else the role's grey, and in trouble the trouble role.
    const kind = lineageOf(item).map((t) => g.cut.types[t]).find(Boolean), seed = seedOf(item.id);
    const d = cutPath({ l, t, r, b }, kind, { rx: Math.min(corner, n.h / 5), depth: depthFor({ depth: g.cut.depth, clear: g.cut.clear, grow: g.cut.grow, phase, h: n.h, lines: n.lines?.length ?? 1, line: n.line }), soft: g.cut.soft, seed });
    const hex = g.cut.colours[phase], named = typeof hex === 'string' && hex.startsWith('#'), cls = named ? `lf-cut-${hex.slice(1).toLowerCase()}` : `lf-cut-${phase === 'trouble' ? 'trouble' : 'none'}`;
    if (named) out.rules = [`.${cls} { fill: ${hex}; }`];
    if (d) out.over.push(m('path', { d, class: `lf-cut ${cls}` }));
  }
  const glyph = glyphOf(g, item);
  if (glyph) out.over.push(m('text', { x: r - z('glyph_inset') - round / 2, y: t + z('glyph_drop'), class: 'lf-glyph' }, glyph));
  return out;
}

/** A mark with a class added to the ones it has. */
function addClass(mark, cls) {
  if (mark?.[1]) mark[1].class = `${mark[1].class ?? ''} ${cls}`.trim();
  return mark;
}

/** The top of an outline as a line, shaped by its kind: flat for a box, rising to a point for a diamond, round for a pill, shouldered for a lozenge, a tab for a place. */
function skyline(n, X, Y, round) {
  const l = X - n.w / 2, r = X + n.w / 2, t = Y - n.h / 2, hh = n.h / 2;
  if (n.shape === 'diamond') return `M${l} ${Y}L${X} ${t}L${r} ${Y}`;
  if (n.shape === 'pill') return `M${l + round} ${t}H${r - round}`;
  if (n.shape === 'hexagon' || n.shape === 'lozenge') return `M${l} ${Y}L${l + round} ${t}H${r - round}L${r} ${Y}`;
  if (n.shape === 'tab') return `M${l} ${t}H${l + n.w / 3}L${l + n.w / 3 + (n.bevel ?? 0)} ${t + (n.bevel ?? 0)}H${r}`;
  return `M${l} ${t}H${r}`;
}
