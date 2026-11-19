// How an item is drawn, as six slots a style sets (round 6, screen e_fgdwazkw): outline (`type_shapes`, in ./index.js),
// ink (`item_ink`), fill (`item_fill`), state (`item_state`), mark (`item_marks`) and text (`item_text`). A pack claims a
// slot for its own type in its preset; a type it does not name falls back to its starter's (`lineageOf`). Only the colour
// roles the page has (land, sea, text, line, muted, you): the looks differ by form, never by a new hue. Every length is the
// style's (sizes, read as --ln-flow-*). Layer: marks. Pure: a style in, css and marks out.

import { cssColour, isColour } from './colour.js';
import { lineageOf } from './graph.js';
import { colourWays, ridgeMarks } from './ridge-item.js';
import { bandsFor, cuts as cutsOf, GROWN, inset, listOf, runsOf, slotOf } from './cut-item.js';
import { seedOf } from './ridge-item.js';
import { bandPath } from './type-outline.js';
import { rangeMarks } from './aim-range.js';
import { crossPath, holdersOf, whoText } from './waymark.js';
import { stateMark } from './session.js';

const words = (v) => String(v ?? '').split(/\s+/).filter(Boolean);
const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const one = (v, from, none) => (from.includes(String(v)) ? String(v) : none);
const PLAIN = ':not(.you):not(.here):not(.focus):not(.ghost):not(.held):not(.waiting)';

/** The ridge a style asks for: its state option, its palette's colours (none: the island's hue), the forms by type and by name. */
const ridgeOf = (style) => (['bands', 'emerge'].includes(style.ridge_state) ? { mode: style.ridge_state, ways: colourWays(record(style.ridge_palettes)[style.ridge_palette] ?? Object.values(record(style.ridge_palettes))[0]), island: !record(style.ridge_palettes)[style.ridge_palette], types: record(style.type_forms), forms: record(style.ridge_forms) } : null);

/** The cut a style asks for: the accent of each phase, the cut of each type, and the dials (depth, softness, room above the name, whether it grows with progress). */
const cutOf = (style) => ((runs, status) => ((runs || Object.keys(status).length) && Object.keys(record(style.cut_forms)).length ? { runs, status, types: record(style.type_cuts), forms: record(style.cut_forms), scale: Number(style.cut_depth) || 1, most: Number(style.cut_most) || 0.92, tension: Number(style.cut_tension), caps: record(style.type_caps), landforms: record(style.ridge_forms), typeForms: record(style.type_forms), clear: Number(style.cut_clear) || 0, grow: style.cut_grow === true, edge: style.cut_edge === 'ink', bands: Math.max(1, Math.round(Number(style.cut_bands) || 1)), inset: Number(style.cut_inset) || 0 } : null))(runsOf(record(style.ridge_palettes)[style.cut_palette]), record(style.status_colours));

/** The outlines a carving style gives one height, and a status colour (./type-outline.js). */
const CARVED = ['carved', 'chamfer', 'fold', 'summit', 'hut', 'hexagon', 'flag', 'pill', 'tab'];

/** The ends a fingerpost board may have (./type-outline.js). */
const BOARDS = ['flag', 'swallow', 'hexagon', 'roundend', 'plank', 'roofed', 'forward', 'roundstart', 'tallarrow', 'pennant'];

/** The fingerpost board a style asks for (pass 9): painted whole in its status colour (`board_fills`: per status, light and dark, a fill and the name's ink on it); the outline is the only type signal. */
const boardOf = (style) => ((fills) => (Object.keys(fills).length ? { fills, who: style.who_strip === true, mark: style.board_mark === true } : null))(record(style.board_fills));

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
    ridge: ridgeOf(style), board: boardOf(style), cut: boardOf(style) ? null : cutOf(style),
    dot: (boardOf(style)?.mark === true || (!ridgeOf(style) && !cutOf(style) && !boardOf(style))) && fill !== 'terrace' && !['double', 'foot', 'notch'].some((w) => state.has(w)),
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
  if (g.board) {
    const plain = ':not(.you):not(.here):not(.focus):not(.ghost):not(.held):not(.waiting)', ld = (f, k) => (f.light ? `light-dark(${cssColour(f.light[k])}, ${cssColour(f.dark[k])})` : cssColour(f[k]));
    for (const [k, f] of Object.entries(g.board.fills)) {
      if (!(f?.light && f?.dark) && !(isColour(f?.fill) && isColour(f?.text))) continue;
      // The whole board in its status colour, the name in the ink that reads on it; "you" keeps its colour as the outline ring.
      rules.push(`.lf-step.boarded.bs-${k}${plain} .lf-shape { fill: ${ld(f, 'fill')}; stroke: color-mix(in srgb, ${ld(f, 'fill')} 65%, var(--ln-text)); stroke-width: var(--ln-flow-stroke); }`);
      rules.push(`.lf-step.boarded.bs-${k}.you .lf-shape, .lf-step.boarded.bs-${k}.here .lf-shape { fill: ${ld(f, 'fill')}; stroke: var(--ln-you); stroke-width: var(--ln-flow-stroke-lit); }`);
      rules.push(`.lf-step.boarded.bs-${k} .lf-who { fill: color-mix(in srgb, ${ld(f, 'fill')} 82%, black); } .lf-step.boarded.bs-${k} .lf-who-mark, .lf-step.boarded.bs-${k}:is(.lf-step) .lf-who-text { fill: ${ld(f, 'text')}; }`);
      rules.push(`.lf-step.boarded.bs-${k}:is(.lf-step) text { fill: ${ld(f, 'text')}; } .lf-sw.bs-${k} .lf-shape { fill: ${ld(f, 'fill')}; stroke: color-mix(in srgb, ${ld(f, 'fill')} 65%, var(--ln-text)); stroke-width: var(--ln-rule); }`);
    }
    // One status vocabulary (the theme's status_*): the board is one neutral card; the state is a mark at its left (ring, half
    // disc, disc) in the status's colour. Only two states go loud: blocked, a red outline and its cross, and what waits on you, a violet outline. A finished name fades.
    if (g.board.mark) {
      const word = { not_started: 'todo', under_way: 'active', waiting: 'waiting', finished: 'done', trouble: 'blocked' };
      for (const [k, name] of Object.entries(word)) rules.push(`.lf-step.boarded .lf-dot.bs-${k} { --lf-dot: var(--ln-status_${name}); }`);
      rules.push('.lf-step.boarded.you .lf-dot { --lf-dot: var(--ln-status_you); } .lf-step.boarded .lf-dot.ph-ended { --lf-dot: var(--ln-status_ended); }');
      rules.push('.lf-step.boarded .lf-dot, .lf-step.boarded .lf-dot circle { stroke: var(--lf-dot, var(--ln-text)); } .lf-step.boarded .lf-dot.full, .lf-step.boarded .lf-dot-fill { fill: var(--lf-dot, var(--ln-text)); }');
      rules.push(`.lf-step.boarded.bs-trouble${plain} .lf-shape, .lf-step.boarded.bs-trouble.you .lf-shape { stroke: var(--ln-status_blocked); stroke-width: var(--ln-flow-stroke-lit); }`);
      rules.push(`.lf-step.boarded.you .lf-shape { stroke: var(--ln-status_you); stroke-width: var(--ln-flow-stroke-lit); }`);
      rules.push('.lf-step.boarded.bs-finished text:not(.lf-who-text) { opacity: 0.6; }');
    }
    rules.push('.lf-step .lf-who-dormant { opacity: 0.6; }');
    rules.push('.lf-step .lf-who-hanger { fill: none; stroke: var(--ln-muted); stroke-width: var(--ln-rule); pointer-events: none; } .lf-step .lf-who { stroke: none; pointer-events: none; } .lf-step .lf-who-text { font-size: var(--ln-flow-who-text); font-family: var(--ln-font); dominant-baseline: middle; pointer-events: none; } .lf-step.boarded .lf-who-text.lf-who-you { fill: var(--ln-you); font-weight: 700; } .lf-step .lf-who-mark { stroke: none; pointer-events: none; }');
    if (g.board.fills.trouble) rules.push(`.lf-step .lf-cross { fill: none; stroke: ${ld(g.board.fills.trouble, 'text')}; stroke-width: var(--ln-flow-stroke-lit); stroke-linecap: round; pointer-events: none; }`);
    // An ended board has no fill, a faded outline and a muted name; the key's types are outlines only.
    rules.push('.lf-step.boarded.bs-ended .lf-shape { fill: none; stroke: var(--ln-muted); stroke-width: var(--ln-rule); } .lf-step.boarded.bs-ended:is(.lf-step) text { fill: var(--ln-muted); } .lf-step.boardkey .lf-shape { fill: none; stroke: var(--ln-muted); stroke-width: var(--ln-flow-stroke); }');
  }
  if (g.cut && Object.keys(g.cut.status).length) {
    for (const [k, v] of Object.entries(g.cut.status)) if (v?.light && v?.dark) rules.push(`.lf-step .lf-cut-s-${k}, .lf-sw.lf-cut-s-${k} { fill: ${k === 'finished' ? `color-mix(in srgb, light-dark(${v.light}, ${v.dark}) var(--ln-flow-done-mix), var(--ln-land))` : `light-dark(${v.light}, ${v.dark})`}; }`);
    // An ended item has no fill and a muted name; a done one keeps its name's ink.
    rules.push('.lf-step.ph-ended .lf-shape { fill: none; } .lf-step.ph-ended text { fill: var(--ln-muted); } .lf-step.closed:not(.ph-ended):not(.dim) text { fill: var(--ln-text); }');
  }
  if (g.cut) rules.push('.lf-step .lf-range { stroke: none; pointer-events: none; } .lf-step .lf-range-1 { fill: color-mix(in srgb, var(--ln-text) 14%, var(--ln-land)); } .lf-step .lf-range-2 { fill: color-mix(in srgb, var(--ln-text) 28%, var(--ln-land)); } .lf-step .lf-range-bare { fill: none; } .lf-step .lf-range-ink { fill: none; stroke: var(--lf-ink, var(--ln-text)); stroke-width: var(--ln-flow-ridge-ink); stroke-linejoin: round; pointer-events: none; }');
  if (g.cut) rules.push(`.lf-step .lf-cut { stroke: ${g.cut.edge ? 'var(--lf-ink, var(--ln-text))' : 'none'}; stroke-width: var(--ln-rule); stroke-linejoin: round; pointer-events: none; } .lf-step .lf-cut-none { fill: var(--ln-muted); } .lf-step .lf-cut-trouble { fill: var(--ln-blocked); } .lf-step.you .lf-cut { fill: var(--ln-you); } .lf-step .lf-shape.lf-edge { fill: none !important; }`);
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
export function itemMarks({ g, n, at: [X, Y], phase, item, z, outline, m, corner, dotAt, viewer, smarks = new Map() }) {
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
  if (g.board && BOARDS.includes(n.shape)) {
    // No plate: the outline says the type, the fill the status. Blocked has a small cross at the board's left, never colour alone.
    const size = z('sign');
    // The who is a small plate hung under the board's left part, as one hangs under a fingerpost: as wide as its text, on two short
    // hangers, only where someone holds the item. The board keeps its height; the plate adds below it, never across a wire's landing.
    const word = statusOf(item, phase), holders = g.board.who ? holdersOf(item, word, viewer) : [];
    if (holders.length) {
      const left = /^(hexagon|roundstart)$/.test(n.shape) ? n.bevel : 0, hs = z('who'), pad = z('who_pad'), mk = z('who_mark'), top = Y + n.h / 2 + z('who_gap'), x0 = l + left + z('who_inset');
      const said = `${word === 'waiting' ? 'waits on ' : ''}${whoText(holders, z('who_most'))}`, wide = Math.min(2 * pad + mk + pad + said.length * z('who_char'), n.w - left - 2 * z('who_inset'));
      out.over.push(m('g', { class: holders[0].dormant ? 'lf-who-dormant' : '' }, m('title', {}, `${word === 'waiting' ? 'Waits on ' : ''}${holders.map((h) => h.full).join(', ')}`),
        m('path', { class: 'lf-who-hanger', d: `M${x0 + pad} ${top - z('who_gap')}V${top}M${x0 + wide - pad} ${top - z('who_gap')}V${top}` }),
        m('rect', { class: 'lf-who', x: x0, y: top, width: wide, height: hs, rx: 2 }),
        // A session's mark is its state's, as the sessions pack's session_marks draw it (a ring idle, a half disc working...); a person's a dot.
        holders[0].kind === 'session' ? (smarks.get(holders[0].state) ? stateMark(m, holders[0].state, smarks.get(holders[0].state), x0 + pad + mk / 2, top + hs / 2, mk / 2) : m('rect', { class: 'lf-who-mark', x: x0 + pad, y: top + hs / 2 - mk / 2, width: mk, height: mk })) : m('circle', { class: 'lf-who-mark', cx: x0 + pad + mk / 2, cy: top + hs / 2, r: mk / 2 }),
        m('text', { class: `lf-who-text${holders[0].you ? ' lf-who-you' : ''}`, x: x0 + 2 * pad + mk, y: top + hs / 2 }, said)));
    }
    if (word === 'trouble') out.over.push(m('path', { class: 'lf-cross', d: crossPath(l + (/^(hexagon|forward|roundstart)$/.test(n.shape) ? n.bevel : 0) + z('sign_margin'), Y - size / 2, size) }));
  } else if (g.cut && CARVED.includes(n.shape)) {
    const lineage = lineageOf(item), list = listOf(g.cut, item, lineage), scale = g.cut.scale * (g.cut.grow ? GROWN[phase] ?? 1 : 1), rules = [];
    const draw = (cls, k, side = 0) => {
      for (const c of cutsOf({ l: l + side, t, r: r - side, b }, inset(list, k, g.cut.inset), { rx: side ? 0 : Math.min(corner, n.h / 5), tension: g.cut.tension, scale, seed: seedOf(item.id), most: g.cut.most })) out.over.push(m('path', { d: c.d, class: `lf-cut ${cls}` }));
    };
    if (Object.keys(g.cut.status).length) {
      // One colour for the item, its status's: waiting is the status a task has; an ended item has no fill, its outline and a muted name.
      const word = statusOf(item, phase), cls = `lf-cut-s-${word}`, piece = (d) => out.over.push(m('path', { d, class: `lf-cut ${cls}` }));
      if (n.shape === 'summit') {
        // The aim alone is a landform: a range over its box, the front layer its status colour; the box is centred in its node.
        const rise = n.bevel, form = g.cut.landforms[lineage.map((x) => g.cut.typeForms[x]).find(Boolean)] ?? Object.values(g.cut.landforms)[0] ?? {};
        out.over.push(...rangeMarks({ id: item.id, form, x0: l + (n.w * (1 - n.span)) / 2, x1: r - (n.w * (1 - n.span)) / 2, base: t + rise, rise, word, m, cols: z('ridge_cols') }));
      } else if (word !== 'ended') {
        // One band of paint along the top of every marker, the same depth for all; the fold, the roof and the summit are outline only.
        const rise = n.shape === 'summit' || n.shape === 'hut' ? n.bevel : 0, box = rise && n.shape === 'summit' ? t + rise : t, deep = g.cut.scale * (b - box) * 0.5;
        piece(bandPath(n.shape, { l, t: n.shape === 'summit' ? t : t, r, b, k: n.bevel ?? 0, d: deep, rx: n.shape === 'carved' ? Math.min(corner, n.h / 5) : 0 }));
      }
    } else {
      // What the cuts take off is banded in the palette: the run of the phase, the colour in it the type's.
      bandsFor(g.cut.runs, phase, slotOf(g.cut, lineage), g.cut.bands).forEach((hex, k) => {
        const cls = `lf-cut-${hex.slice(1).toLowerCase()}`;
        rules.push(`.${cls} { fill: ${hex}; }`);
        draw(cls, k);
      });
    }
    out.rules = rules;
    // The box's outline is drawn once more over the fill.
    out.over.push(((edge) => (edge[1].class += ' lf-edge', edge))(outline(n.shape, X, Y, n.w, n.h, corner, n.bevel)));
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

/** The status an item shows: its phase, but waiting where its status says so and nothing has finished it. */
export const statusOf = (item, phase) => (item.status === 'waiting' && !/^(finished|ended|trouble)$/.test(phase) ? 'waiting' : phase === 'standing' ? 'under_way' : /^(not_started|under_way|finished|ended|trouble)$/.test(phase) ? phase : 'not_started');

/** The key's rows for a cut's palette: each run as a row of swatches, labelled with the role it plays (the phase). Colour rules for them too. */
export function swatchRows(cut, { m, w, h, roles, words = {}, sw = Math.min(w, h) }) {
  if (Object.keys(cut.status).length) {
    // Just the statuses, one swatch each, with their words.
    const rows = Object.keys(words).filter((k) => cut.status[k]).map((k) => ({ glyph: m('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` }, m('rect', { class: `lf-sw lf-cut-s-${k}`, x: (w - sw) / 2, y: (h - sw) / 2, width: sw, height: sw })), label: words[k], tip: `${words[k]}: the colour of an item with that status` }));
    return { rows, rules: [] };
  }
  return swatchRunRows(cut, { m, w, h, roles });
}

function swatchRunRows(cut, { m, w, h, roles }) {
  const rules = new Set(), rows = Object.entries(roles).filter(([run]) => cut.runs[run]?.length).map(([run, label]) => {
    const colours = cut.runs[run], cell = w / colours.length;
    colours.forEach((hex) => rules.add(`.lf-sw-${hex.slice(1).toLowerCase()} { fill: ${hex}; stroke: none; }`));
    return { glyph: m('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` }, ...colours.map((hex, k) => m('rect', { class: `lf-sw lf-sw-${hex.slice(1).toLowerCase()}`, x: k * cell, y: 0, width: cell, height: h }))), label, tip: `${label}: the ${run} run of the palette` };
  });
  return { rows, rules: [...rules] };
}

/** The key's rows for the fingerpost boards: the types the island draws as outlines with no fill, then the statuses as small filled boards. */
export function boardKeyRows(board, { types, m, outline, w, h, margin, shapes, words, statusWords }) {
  const rows = types.filter((t) => shapes[t]).map((t) => ({ glyph: m('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` }, m('g', { class: 'lf-step boardkey' }, outline(shapes[t], w / 2, h / 2, w - 2 * margin, h * 0.62, 0, (h * 0.62) / 3))), label: words[t] ?? t[0].toUpperCase() + t.slice(1), tip: `${words[t] ?? t}: its outline` }));
  const small = Object.keys(statusWords).filter((k) => board.fills[k]).map((k) => ({ glyph: m('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` }, m('g', { class: `lf-step lf-sw bs-${k}` }, outline('plank', w / 2, h / 2, w - 2 * margin, h * 0.45, 0, 0))), label: statusWords[k], tip: `${statusWords[k]}: the colour of its board` }));
  return [...rows, ...small];
}
