// A box cut by a mountain curve (round 6, screen e_vm8eg36x, from Alex's sketch of 19 Nov 2026; pass 2: a cleaner curve
// grammar). The item stays a box with its ink outline and its name, and what a cut takes off, between the box's edge and the
// curve, is filled in the accent of the item's phase. A cut is a list of two primitives, nothing else, drawn with cubics at
// one tension (a style value) so every curve meets the box edge, and its neighbour, with a matching tangent:
//   corner { at: 'tl' | 'tr' | 'bl' | 'br', w, d }: an arc filling a corner, tangent to both edges it meets (w a share of the
//     width, d of the height);
//   summit { at, w, d, skew }: a mountain on the box's top edge: its summit touches the edge at `at` (a share of the width), it
//     falls `d` (a share of the height) over `w` of the width to flat feet, level at the summit and level at the feet;
//     `skew` (-1 to 1) makes one side steeper. What is cut is the sky: between the top edge and that skyline, the box under
//     it the mountain. All the summits of a list make one skyline, with a saddle between neighbours.
// A type names such a list, or a name in `cut_forms` (slope, twin, ring, peak, spire, dome: lists in the style's data), so a
// pack names its own type's cut with the same two primitives. The only jitter is a small seeded shift of a summit's place. The
// box grows to hold the deepest cut, and the name sits in the band below it (`boxHeight`).
// The whole palette is used: a cut is two or three nested bands (the same curves inset), each a colour of the run the phase
// picks (pale to do, land under way, deep done, greys ended, an accent in trouble), and the item's type picks which colour of
// the run, so types read apart too (`runsOf`, `bandsFor`).
// Layer: marks. Pure: a box, a list and a seed in, paths and their cubics out.

/** A small variation from a seed and a key: -1 to 1, the same for the same ones (a text key is hashed). */
export const vary = (seed, key) => {
  let h = seed >>> 0;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 0x1000193);
  return ((Math.imul(h, 0x85ebca77) >>> 0) / 0x100000000) * 2 - 1;
};

/** How much of its depth a cut takes by phase, where the style says it grows with progress. */
export const GROWN = { not_started: 0.45, under_way: 0.7, finished: 1, ended: 1, trouble: 0.85 };

import { chroma, light } from './ridge-item.js';

const isCorner = (p) => typeof p?.at === 'string';

/** The list of primitives a type's cut is: the list itself, or the named one in `forms`. */
export const listOf = (cut, item, lineage) => {
  const named = lineage.map((t) => cut.types[t]).find((v) => v !== undefined);
  const list = Array.isArray(named) ? named : cut.forms[named];
  return Array.isArray(list) ? list.filter((p) => p && p.d > 0 && p.w > 0) : [];
};

/** How far down a list cuts at most, as a share of the height, counting what hangs from the top: the name sits below it. */
export const bandOf = (list) => list.filter((p) => !isCorner(p) || p.at[0] === 't').reduce((deepest, p) => Math.max(deepest, p.d), 0);

/** The height of a box that holds a list's deepest cut over its name: the name's lines, the room below them, and `clear` above. */
export const boxHeight = (list, textH, pad, clear) => (clear + textH + pad) / (1 - Math.min(0.9, bandOf(list)));

const at = (p) => `${+p[0].toFixed(2)} ${+p[1].toFixed(2)}`;
const draw = (c) => `C${at(c[1])} ${at(c[2])} ${at(c[3])}`;

/**
 * The cuts of a box as regions: each { d, cubics } with the cubic curves its edge is made of ([p0, p1, p2, p3] each), for
 * `box` { l, t, r, b } with corner `rx`, at `tension` (the share of a leg a curve's handle takes; 0.55 is a circle's).
 * `scale` multiplies every depth (the style's dial, and the phase's where it grows), `most` is the deepest a cut may be, as a share
 * of the height (`cut_most`), and `seed` the item's id's number.
 */
export function cuts(box, list, { rx, tension, scale = 1, seed = 0, most = 0.92 }) {
  const w = box.r - box.l, h = box.b - box.t, out = [], summits = [];
  for (const p of list) {
    const d = Math.min(most, p.d * scale);
    if (!isCorner(p)) { summits.push({ p, d }); continue; }
    // Along the edge by `a`, down the other by `c`; a quarter of an ellipse, tangent to both. The box's own corner is followed round.
    const sx = p.at[1] === 'l' ? 1 : -1, sy = p.at[0] === 't' ? 1 : -1, cx = sx > 0 ? box.l : box.r, cy = sy > 0 ? box.t : box.b;
    const a = Math.max(rx + 1, Math.min(0.9 * w, p.w * w)), c = Math.max(rx + 1, Math.min(0.9 * h, d * h)), q = (u, v) => [cx + sx * u, cy + sy * v];
    const arc = [q(0, c), [q(0, c)[0], q(0, c)[1] - sy * tension * c], [q(a, 0)[0] - sx * tension * a, q(a, 0)[1]], q(a, 0)];
    const sweep = sx * sy < 0 ? 1 : 0;
    out.push({ cubics: [arc], d: `M${at(q(a, 0))}L${at(q(rx, 0))}A${rx} ${rx} 0 0 ${sweep} ${at(q(0, rx))}L${at(q(0, c))}${draw(arc)}Z` });
  }
  if (!summits.length) return out;
  // The skyline: flat at the deepest foot's level, each summit rising from it to the top edge (less where it is less deep),
  // level at both ends of each half so there is no kink at the summit or the foot. The sky above it is the cut.
  const level = Math.max(rx + 1, Math.max(...summits.map((m) => m.d)) * h), peaks = summits.map(({ p, d }) => {
    const half = (p.w * w) / 2, skew = (p.skew ?? 0) * 0.6, mid = box.l + (p.at + vary(seed, `at${p.at}`) * 0.03) * w;
    return { xm: mid, xa: Math.max(box.l + rx, mid - half * (1 - skew)), xb: Math.min(box.r - rx, mid + half * (1 + skew)), y: box.t + level - d * h };
  }).sort((u, v) => u.xm - v.xm);
  const half2 = (x0, y0, x1, y1) => [[x0, y0], [x0 + tension * (x1 - x0), y0], [x1 - tension * (x1 - x0), y1], [x1, y1]];
  const cubics = [];
  let d = `M${at([box.l + rx, box.t])}H${box.r - rx}A${rx} ${rx} 0 0 1 ${at([box.r, box.t + rx])}V${box.t + level}`;
  for (const k of [...peaks].reverse()) {
    const right = half2(k.xb, box.t + level, k.xm, k.y), left = half2(k.xm, k.y, k.xa, box.t + level);
    cubics.push(right, left);
    d += `H${+k.xb.toFixed(2)}${draw(right)}${draw(left)}`;
  }
  out.push({ cubics, d: `${d}H${box.l}V${box.t + rx}A${rx} ${rx} 0 0 1 ${at([box.l + rx, box.t])}Z` });
  return out;
}

/** The runs of a palette, each a list of its colours: pale (the lightest third), land (the middle), deep (the darkest), grey (the least coloured) and accent (the most). */
export function runsOf(palette) {
  const all = [...new Set((palette?.colours ?? []).filter((c) => new RegExp('^#[0-9a-f]{6}$', 'i').test(c)))];
  if (!all.length) return null;
  const byLight = [...all].sort((a, b) => light(b) - light(a)), third = Math.max(1, Math.round(all.length / 3));
  const byChroma = [...all].sort((a, b) => chroma(a) - chroma(b));
  return { pale: byLight.slice(0, third), land: byLight.slice(third, all.length - third), deep: byLight.slice(all.length - third), grey: byChroma.slice(0, third + 1).sort((a, b) => light(b) - light(a)), accent: byChroma.slice(-third).reverse() };
}

/** The run each phase takes from a palette's runs: to do its pale, under way its land, done its deep, ended its greys, trouble an accent. */
export const RUN = { not_started: 'pale', under_way: 'land', finished: 'deep', ended: 'grey', trouble: 'accent' };
/** What each type is called in the key where the style names it otherwise than by its id. */
export const TYPE_WORDS = { question: 'Decision' };
/** What each status is called in the key. */
export const STATUS_WORDS = { not_started: 'To do', under_way: 'In progress', waiting: 'Waiting', finished: 'Done', trouble: 'Blocked' };
/** What each run is called in the key. */
export const ROLES = { pale: 'To do', land: 'Under way', deep: 'Done', grey: 'Ended', accent: 'Trouble' };

/** The colours of `n` nested bands for a phase, outermost first: the run's, from the item type's place in it. */
export function bandsFor(runs, phase, slot, n) {
  const run = runs?.[RUN[phase] ?? 'grey']?.length ? runs[RUN[phase] ?? 'grey'] : runs?.grey ?? [];
  return run.length ? Array.from({ length: n }, (_, k) => run[(slot + k) % run.length]) : [];
}

/** The type a list was named for, as its place among the types the style gives a cut: its colour's place in a run. */
export const slotOf = (cut, lineage) => Math.max(0, Object.keys(cut.types).indexOf(lineage.find((t) => cut.types[t] !== undefined)));

/** A list drawn inside itself, band `k` of them: the same primitives, shallower by `inset` each (a corner narrower too). */
export const inset = (list, k, share) => list.map((p) => ({ ...p, ...(isCorner(p) && { w: p.w * (1 - k * share) }), d: p.d * (1 - k * share * 1.4) }));
