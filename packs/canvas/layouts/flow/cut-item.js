// A box cut by a mountain curve (round 6, screen e_vm8eg36x, from Alex's sketch of 19 Nov 2026; pass 2: a cleaner curve
// grammar). The item stays a box with its ink outline and its name, and what a cut takes off, between the box's edge and the
// curve, is filled in the accent of the item's phase. A cut is a list of two primitives, nothing else, drawn with cubics at
// one tension (a style value) so every curve meets the box edge, and its neighbour, with a matching tangent:
//   corner { at: 'tl' | 'tr' | 'bl' | 'br', w, d }: an arc filling a corner, tangent to both edges it meets (w a share of the
//     width, d of the height);
//   bell { at, w, d, skew }: a hill hanging from the top edge, flat where it leaves the edge and flat at its lowest point;
//     its middle at `at` (a share of the width), `skew` (-1 to 1) moving the low point and making one side steeper.
// A type names such a list, or a name in `cut_forms` (slope, twin, ring, peak, spire, dome: lists in the style's data), so a
// pack names its own type's cut with the same two primitives. The only jitter is a small seeded shift of a bell's place. The
// box grows to hold the deepest cut, and the name sits in the band below it (`boxHeight`).
// Layer: marks. Pure: a box, a list and a seed in, paths and their cubics out.

/** A small variation from a seed and a key: -1 to 1, the same for the same ones (a text key is hashed). */
export const vary = (seed, key) => {
  let h = seed >>> 0;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 0x1000193);
  return ((Math.imul(h, 0x85ebca77) >>> 0) / 0x100000000) * 2 - 1;
};

/** How much of its depth a cut takes by phase, where the style says it grows with progress. */
export const GROWN = { not_started: 0.45, under_way: 0.7, finished: 1, ended: 1, trouble: 0.85 };

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
 * `scale` multiplies every depth (the style's dial, and the phase's where it grows) and `seed` the item's id's number.
 */
export function cuts(box, list, { rx, tension, scale = 1, seed = 0 }) {
  const w = box.r - box.l, h = box.b - box.t, out = [];
  for (const p of list) {
    const d = Math.min(0.92, p.d * scale);
    if (isCorner(p)) {
      // Along the edge by `a`, down the other by `c`; a quarter of an ellipse, tangent to both. The box's own corner is followed round.
      const sx = p.at[1] === 'l' ? 1 : -1, sy = p.at[0] === 't' ? 1 : -1, cx = sx > 0 ? box.l : box.r, cy = sy > 0 ? box.t : box.b;
      const a = Math.max(rx + 1, Math.min(0.9 * w, p.w * w)), c = Math.max(rx + 1, Math.min(0.9 * h, d * h)), q = (u, v) => [cx + sx * u, cy + sy * v];
      const arc = [q(0, c), [q(0, c)[0], q(0, c)[1] - sy * tension * c], [q(a, 0)[0] - sx * tension * a, q(a, 0)[1]], q(a, 0)];
      const sweep = sx * sy < 0 ? 1 : 0;
      out.push({ cubics: [arc], d: `M${at(q(a, 0))}L${at(q(rx, 0))}A${rx} ${rx} 0 0 ${sweep} ${at(q(0, rx))}L${at(q(0, c))}${draw(arc)}Z` });
      continue;
    }
    // A bell: flat where it leaves the top edge and flat at its lowest point, the low point shifted by the skew.
    const half = (p.w * w) / 2, mid = box.l + (p.at + vary(seed, `at${p.at}`) * 0.03) * w, depth = d * h;
    const xa = Math.max(box.l + rx, mid - half), xb = Math.min(box.r - rx, mid + half), low = Math.min(xb - 1, Math.max(xa + 1, mid + (p.skew ?? 0) * (xb - xa) * 0.28));
    // Each half has both handles along the level: level at the edge, level at the low point, so no kink at either.
    const half2 = (x0, y0, x1, y1) => [[x0, y0], [x0 + tension * (x1 - x0), y0], [x1 - tension * (x1 - x0), y1], [x1, y1]];
    const left = half2(xa, box.t, low, box.t + depth), right = half2(low, box.t + depth, xb, box.t);
    out.push({ cubics: [left, right], d: `M${at(left[0])}${draw(left)}${draw(right)}Z` });
  }
  return out;
}
