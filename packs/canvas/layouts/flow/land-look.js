// How the land is drawn, in the same vocabulary as the items (round 6, screen e_3sf9hbu9, taken from the Ridges sketch):
// `sea` (flat, rows), `land_ground` (tint, clear, rows, bands), `land_edge` (rule, terrace, shallows, skyline), `row` (the
// pitch of the rows, a length) and `row_snap` (items set on the rows). The rows are the plane and the line items stand
// on; shallows say how far an island reaches; terrace steps say a phase; a skyline is a top where a name sits. Hues are
// the island's own (`--lf-island`); rows and ink are the colour roles the page has: no new colour. Every count and
// width is the style's (sizes, read as --ln-flow-*). Layer: marks. Pure: a style and the islands' places in, marks out.

import { islandHue } from './islands.js';

const one = (v, from, none) => (from.includes(String(v)) ? String(v) : none);

/** What a style says of the land: its sea, ground, edge, row pitch and whether items snap to the rows. */
export function landGrammar(style) {
  const row = Number(style.row);
  return {
    sea: one(style.sea, ['flat', 'rows'], 'flat'), ground: one(style.land_ground, ['tint', 'clear', 'rows', 'bands'], 'tint'),
    edge: one(style.land_edge, ['rule', 'terrace', 'shallows', 'skyline'], 'rule'), row: row > 0 ? row : 0, snap: style.row_snap === true && row > 0,
  };
}

/** Whether the style draws any of the land itself (else the house land stands as it did). */
export const landOwn = (g) => g.sea !== 'flat' || g.ground !== 'tint' || g.edge !== 'rule';

/** The css of the land slots, over ./islands.js's. */
export function landRules(style) {
  const g = landGrammar(style), r = [];
  if (g.sea === 'rows') r.push('.lf-sea-rows { fill: none; stroke: color-mix(in srgb, var(--ln-text) var(--ln-flow-row-mix), transparent); stroke-width: var(--ln-flow-row-stroke); pointer-events: none; }');
  // The ground is drawn under the island's name and key (its own land rect then clear, or left to the marks under it).
  if (g.ground !== 'tint') r.push(`.lf-region .lf-land :is(rect, path) { fill: ${g.ground === 'clear' ? 'var(--ln-sea)' : 'none'}; } .lf-ground { fill: var(--ln-sea); stroke: none; pointer-events: none; }`);
  if (g.ground === 'rows') r.push('.lf-land-rows { fill: none; stroke: color-mix(in srgb, var(--lf-island, var(--ln-line)) var(--ln-flow-land-row-mix), transparent); stroke-width: var(--ln-flow-row-stroke); pointer-events: none; }');
  if (g.ground === 'bands') r.push('.lf-band { fill: color-mix(in srgb, var(--lf-island, var(--ln-line)) var(--lf-band-mix), var(--ln-sea)); stroke: none; pointer-events: none; }');
  if (g.edge !== 'rule') r.push('.lf-region .lf-shore :is(rect, path) { stroke: none; }');
  if (g.edge === 'terrace') r.push('.lf-terrace-edge { fill: none; stroke: var(--lf-island, var(--ln-line)); stroke-width: var(--ln-flow-island-stroke); stroke-linejoin: round; pointer-events: none; }');
  if (g.edge === 'shallows') r.push('.lf-shallow { fill: none; stroke: var(--lf-island, var(--ln-line)); stroke-width: var(--ln-flow-row-stroke); opacity: var(--lf-shallow-op); pointer-events: none; } .lf-shallow-shore { fill: none; stroke: var(--lf-island, var(--ln-line)); stroke-width: var(--ln-flow-island-stroke); pointer-events: none; }');
  if (g.edge === 'skyline') r.push('.lf-skyline-edge { fill: none; stroke: var(--lf-ink, var(--ln-text)); stroke-width: var(--ln-flow-stroke-ink); stroke-linejoin: round; pointer-events: none; }');
  return r.join('\n');
}

/** The rows from `l` to `r`, `y0` to `y1`, every `pitch`, as one path. */
const rowsPath = (l, r, y0, y1, pitch) => {
  let d = '';
  for (let y = Math.ceil(y0 / pitch) * pitch; y < y1; y += pitch) d += `M${l} ${y}H${r}`;
  return d;
};

/** A ziggurat: the top of a box in `n` steps of `s` going in from each side, from the foot of its left side to the foot of its right. */
const steps = (l, t, r, b, n, s) => {
  let d = `M${l} ${b}V${t + n * s}`;
  for (let k = n - 1; k >= 0; k--) d += `H${l + (n - k) * s}V${t + k * s}`;
  d += `H${r - n * s}`;
  for (let k = 1; k <= n; k++) d += `V${t + k * s}H${r - (n - k) * s}`;
  return `${d}V${b}`;
};

/**
 * The land's marks: `sea` (rows over the whole picture, drawn first), `land` (what each island has over its ground, by
 * its id), `classOf` (the class that gives a thing on an island its hue, by island id). `size` is the picture's.
 */
export function landMarks({ style, g, islands, size, z, m, isHex }) {
  const land = landGrammar(style), classes = new Map();
  (islands ?? []).forEach((isle, k) => {
    const hex = islandHue(style, isHex, k);
    classes.set(isle.id, hex ? `lf-island lf-i-${hex.slice(1).toLowerCase()}` : 'lf-island');
  });
  const sea = land.sea === 'rows' && land.row ? [m('path', { class: 'lf-sea-rows', d: rowsPath(0, size.width, 0, size.height, land.row) })] : [];
  if (!landOwn(land)) return { sea, land: [], classOf: (id) => classes.get(id) ?? '', grammar: land };
  const layer = (islands ?? []).filter((isle) => !String(isle.id).startsWith('parts:')).map((isle) => {
    const marks = [];
    for (const r of isle.land) {
      const [w, h] = [r.r - r.l, r.b - r.t];
      if (land.ground === 'rows' || land.ground === 'bands') marks.push(m('rect', { class: 'lf-ground', x: r.l, y: r.t, width: w, height: h, rx: z('island_corner') }));
      if (land.ground === 'rows' && land.row) marks.push(m('path', { class: 'lf-land-rows', d: rowsPath(r.l, r.r, r.t, r.b, land.row / z('land_row_dense')) }));
      if (land.ground === 'bands') {
        const n = z('bands'), gap = z('band_step');
        for (let k = 0; k < n; k++) marks.push(m('rect', { class: `lf-band lf-band-${k}`, x: r.l + k * gap, y: r.t + k * gap, width: Math.max(0, w - 2 * k * gap), height: Math.max(0, h - 2 * k * gap) }));
      }
      if (land.edge === 'terrace') marks.push(m('path', { class: 'lf-terrace-edge', d: steps(r.l, r.t, r.r, r.b, z('terrace_steps'), z('terrace_step')) }));
      if (land.edge === 'shallows') {
        for (let k = z('shallows'); k >= 1; k--) marks.push(m('rect', { class: `lf-shallow lf-shallow-${k}`, x: r.l - k * z('shallow_gap'), y: r.t - k * z('shallow_gap'), width: w + 2 * k * z('shallow_gap'), height: h + 2 * k * z('shallow_gap'), rx: z('island_corner') + k * z('shallow_gap') }));
        marks.push(m('rect', { class: 'lf-shallow-shore', x: r.l, y: r.t, width: w, height: h, rx: z('island_corner') }));
      }
      if (land.edge === 'skyline') ((s) => marks.push(m('path', { class: 'lf-skyline-edge', d: `M${r.l} ${r.t + 2 * s}V${r.t + s}H${r.l + s}V${r.t}H${r.r - s}V${r.t + s}H${r.r}V${r.t + 2 * s}` })))(z('terrace_step'));
    }
    return m('g', { class: `${classes.get(isle.id)} lf-land-look` }, ...marks);
  });
  return { sea, land: layer, classOf: (id) => classes.get(id) ?? '', grammar: land };
}

/** The css of what the land slots read as sizes: the band shades and the shallows' fade, by `k`. */
export function landShades(style) {
  const g = landGrammar(style), n = Number(style.sizes?.flow_bands) || 0, s = Number(style.sizes?.flow_shallows) || 0, out = [];
  if (g.ground === 'bands') for (let k = 0; k < n; k++) out.push(`.lf-band-${k} { --lf-band-mix: ${(k + 1) * parseFloat(style.sizes?.flow_band_mix)}%; }`);
  if (g.edge === 'shallows') for (let k = 1; k <= s; k++) out.push(`.lf-shallow-${k} { --lf-shallow-op: ${(1 - k / (s + 1)).toFixed(2)}; }`);
  return out.join('\n');
}
