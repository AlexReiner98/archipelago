// An item drawn as a Ridges mountain (round 6, screen e_yczjweyh): its type picks a landform (the style's `type_forms`,
// each form's dials in `ridge_forms`, after FORMS in sketches/ridges/palettes.js), its state picks colours from a palette
// (`ridge_palettes`, named by `ridge_palette`): option A `bands` (pale neutrals not started, its land colours under way,
// darker with a snow cap finished, an accent in trouble) or B `emerge` (an accent ridge rising behind a neutral one with
// progress). One profile per item: a stair-stepped height, the way Ridges builds a row (a bump, ruggedness, a flat top,
// sheer sides, a reef's ring, steps at a pitch, softened), seeded by the item's id so it is the same every time.
// Layer: marks. Pure: the item's id, place, form, state and palette in; marks and colour rules out.

/** A number from a name, the same each time. */
export function seedOf(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 0x1000193);
  return h >>> 0;
}

/** Smooth value noise in one dimension, from a seed: 0 to 1. */
function noise(seed) {
  const at = (i) => ((Math.imul(i ^ seed, 0x85ebca77) ^ (Math.imul(i, 0xc2b2ae3d) >>> 13)) >>> 0) / 0x100000000;
  return (x) => {
    const i = Math.floor(x), f = x - i, t = f * f * (1.5 - f) * 2;
    return at(i) * (1 - t) + at(i + 1) * t;
  };
}

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/**
 * The heights (0 to about 1) of a landform across `cols` columns. `form`: rise, rugged, step, soft, top, cliff, atoll
 * as Ridges' FORMS, and `summits` (how many peaks), `levels` (steps in the height at step 1).
 */
export function profile(form, seed, cols) {
  const f = { rise: 1, rugged: 0, step: 1, soft: 0, top: 0, cliff: 0, summits: 1, levels: 2 ** 3, ...form }, n = noise(seed), phase = (seed % 97) / 97 * Math.PI;
  const levels = Math.max(2, Math.round(f.levels / f.step)), blend = clamp(0.4 + f.soft * 1.5);
  return Array.from({ length: cols }, (_, i) => {
    const t = cols > 1 ? i / (cols - 1) : 0.5;
    let e = Math.sin(Math.PI * t) ** (1 - f.cliff * 0.75);
    if (f.summits > 1) e *= 0.62 + 0.38 * Math.abs(Math.sin(f.summits * Math.PI * t + phase));
    let h = e * (1 + f.rugged * (n(t * 6 + 1) - 0.5) * 1.6);
    if (f.top > 0) { const c = 1 - f.top * 0.45; h = Math.min(h, c) / c; }
    if (f.atoll) h *= 1 - 0.7 * Math.exp(-(((t - 0.5) / 0.18) ** 2));
    h = clamp(h * f.rise, 0, 1.3);
    const q = Math.round(h * levels) / levels;
    return q + (h - q) * blend;
  });
}

/** A stair-stepped area from heights: columns from `x0` to `x1`, standing on `base`, `hgt` tall at height 1, over `floor` of it. */
export function steps(heights, x0, x1, base, hgt, floor = 0) {
  const w = (x1 - x0) / heights.length, top = (h) => base - Math.max(0, h - floor) * hgt;
  let d = `M${x0} ${base}V${top(heights[0])}`;
  heights.forEach((h, i) => { d += `${i ? `V${top(h)}` : ''}H${x0 + (i + 1) * w}`; });
  return `${d}V${base}Z`;
}

/** The top of a stair-stepped area alone, an open line, for the inked outline. */
export function skyline(heights, x0, x1, base, hgt) {
  const w = (x1 - x0) / heights.length;
  return heights.map((h, i) => `${i ? 'L' : 'M'}${x0 + i * w} ${base - h * hgt}H${x0 + (i + 1) * w}`).join('');
}

/** A six-digit colour: a pattern, so it is written as text. */
const HEX6 = new RegExp('^#[0-9a-f]{6}$', 'i');
const rgb = (hex) => [1, 1 + 2, 1 + 2 * 2].map((k) => parseInt(String(hex).slice(k, k + 2), 0x10));
const light = (hex) => ((r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b)(...rgb(hex));
const chroma = (hex) => ((c) => Math.max(...c) - Math.min(...c))(rgb(hex));

/** What a palette gives each state: its neutrals (pale to dark), its land colours, its darkest and its accent. */
export function colourWays(palette) {
  const all = [...new Set((palette?.colours ?? []).filter((c) => HEX6.test(c)))];
  if (!all.length) return null;
  const byLight = [...all].sort((a, b) => light(b) - light(a)), byChroma = [...all].sort((a, b) => chroma(a) - chroma(b));
  const neutral = byChroma.slice(0, Math.max(1 + 2, Math.ceil(all.length / 3))).sort((a, b) => light(b) - light(a));
  const mid = byLight.slice(Math.floor(all.length / 3), Math.floor(all.length / 3) + 1 + 2);
  return { neutral, pale: neutral.slice(0, 1 + 2), mid: mid.length ? mid : byLight, dark: byLight.slice(-(1 + 2)), accent: byChroma[byChroma.length - 1], paper: HEX6.test(palette.paper) ? palette.paper : byLight[0] };
}

/** The colour of each band, back to front, by state, for option A. */
export function bandsOf(ways, phase) {
  if (phase === 'finished' || phase === 'ended') return ways.dark;
  if (phase === 'trouble') return [ways.neutral[0], ways.accent, ways.accent];
  return phase === 'under_way' ? ways.mid : ways.pale;
}

/**
 * The marks of one item: its mountain over the box `x0..x1`, standing on `base`, up to `hgt` tall. `mode` is `bands` or
 * `emerge`; `ways` the palette's (colourWays), or null for the island's own hue as the accent. A colour is a class with a rule of
 * its own (`rules`), as the flow does its link colours: a drawing sets no style on a mark.
 */
export function ridgeMarks({ id, x0, x1, base, hgt, form, phase, mode, ways, island, m, cols, bands }) {
  const seed = seedOf(id), heights = profile(form, seed, cols), rules = new Set();
  const cls = (hex, prefix = 'lf-rc') => {
    if (!hex) return `${prefix}-island`;
    const c = `${prefix}-${hex.slice(1).toLowerCase()}`;
    rules.add(`.${c} { fill: ${hex}; }`);
    return c;
  };
  const pale = ways?.pale ?? [], marks = [];
  if (mode === 'emerge') {
    // Progress: hidden not started, about half risen under way, clear above when finished; a neutral ridge in front.
    const rise = { not_started: 0, under_way: 0.55, finished: 1.15, ended: 1.15, trouble: 0.8 }[phase] ?? 0;
    const grey = ways?.neutral ?? [];
    if (rise > 0) marks.push(m('path', { class: `lf-ridge lf-ridge-back ${ways && !island ? cls(ways.accent) : 'lf-rc-island'}`, d: steps(heights, x0, x1, base, hgt * rise) }));
    marks.push(m('path', { class: `lf-ridge lf-ridge-front ${cls(grey[grey.length - 1])}`, d: steps(heights.map((h) => h * 0.8), x0, x1, base, hgt * 0.72) }));
    marks.push(m('path', { class: 'lf-ridge-ink', d: skyline(heights.map((h) => h * 0.8), x0, x1, base, hgt * 0.72) }));
    return { marks, rules: [...rules] };
  }
  const colours = ways ? bandsOf(ways, phase) : pale;
  colours.forEach((hex, k) => marks.push(m('path', { class: `lf-ridge ${cls(hex)}`, d: steps(heights, x0, x1, base, hgt * (1 - (k / bands) * 0.55)) })));
  // A snow cap on what is finished: the top of the summit in the palette's paper.
  if (ways && (phase === 'finished' || phase === 'ended')) marks.push(m('path', { class: `lf-ridge lf-ridge-cap ${cls(ways.paper, 'lf-rp')}`, d: ((c) => steps(heights.map((h) => Math.max(0, h - c)), x0, x1, base - c * hgt, hgt))(0.78 * Math.max(...heights)) }));
  marks.push(m('path', { class: 'lf-ridge-ink', d: skyline(heights, x0, x1, base, hgt) }));
  return { marks, rules: [...rules] };
}
