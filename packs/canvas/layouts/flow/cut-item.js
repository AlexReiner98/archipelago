// A box cut by a mountain curve (round 6, screen e_vm8eg36x, from Alex's sketch of 19 Nov 2026): the item stays a box with
// its ink outline and its name, and a smooth cubic curve cuts into it from its edges; what is cut off, between the edge and
// the curve, is filled in the accent of the item's phase. The cut's kind comes from the type (`type_cuts`): slope (a ridge
// falling into the top right), twin (two hills in the top corners), ring (arcs in all four corners), peak (one summit in the
// top middle), spire (a tall narrow peak, cut deepest) and dome (a broad low curve along the top). Each is seeded by the
// item's id, so a box differs a little from its neighbours and is the same each time. Its depth, the curve's softness, the
// room kept clear above the name and the colours are the style's (`cut_depth`, `cut_soft`, `cut_clear`, `cut_grow`,
// `cut_colours`): the cut never reaches the name. Layer: marks. Pure: a box, a kind and a seed in, a path out.

import { seedOf } from './ridge-item.js';

/** How deep each kind cuts, as a share of the style's depth. */
export const DEEP = { slope: 0.85, twin: 0.7, ring: 0.9, peak: 0.75, spire: 1, dome: 0.45 };
/** How sharp the bottom of a top-edge cut is: a point (1) to a broad curve (0). */
const SHARP = { peak: 0.85, spire: 0.92, dome: 0.1 };
/** How much of the width a top-edge cut spans (half of it), a corner cut reaches along the edge. */
const SPAN = { peak: 0.17, spire: 0.09, dome: 0.38, slope: 0.6, twin: 0.28 };

/** A small variation from the seed: -1 to 1, the same for the same seed and `k`. */
export const vary = (seed, key) => (((Math.imul(seed ^ seedOf(String(key)), 0x85ebca77) >>> 0) / 0x100000000) * 2) - 1;

/** The progress each phase stands for, as the share of the style's depth the cut takes when it grows with progress. */
export const GROWN = { not_started: 0.45, under_way: 0.7, finished: 1, ended: 1, trouble: 0.85 };

/**
 * A cut in the corner of a box: from `reach` along one edge, round the box's own corner (radius `rx`), `depth` down the
 * other, and back by a smooth curve. `sx`, `sy` are which corner it is (1, 1 top left; -1, 1 top right...).
 */
function corner({ l, t, r, b }, sx, sy, reach, depth, rx, soft, sharp) {
  const cx = sx > 0 ? l : r, cy = sy > 0 ? t : b, p = (u, v) => `${cx + sx * u} ${cy + sy * v}`;
  const sweep = sx * sy < 0 ? 1 : 0;
  return `M${p(reach, 0)}L${p(rx, 0)}A${rx} ${rx} 0 0 ${sweep} ${p(0, rx)}L${p(0, depth)}C${p(reach * (1 - sharp), depth)} ${p(reach * (1 - soft), 0)} ${p(reach, 0)}Z`;
}

/** A cut along the top edge, centred at `xm`, `half` wide each way: a lens whose bottom is a point (sharp) or a curve. */
function lens(t, xm, half, depth, soft, sharp) {
  const [xa, xb] = [xm - half, xm + half], reach = half * (1 - sharp), ease = half * soft;
  return `M${xa} ${t}H${xb}C${xb - ease} ${t} ${xm + reach} ${t + depth} ${xm} ${t + depth}C${xm - reach} ${t + depth} ${xa + ease} ${t} ${xa} ${t}Z`;
}

/**
 * The path of a cut: `box` { l, t, r, b } and its corner `rx`, the cut's `kind`, how far down it may reach (`depth`, already
 * under the name's top), `soft` (0 to 1, how long the curve hugs the edge) and the item's `seed`. A kind not known cuts nothing.
 */
export function cutPath(box, kind, { rx, depth, soft, seed }) {
  const w = box.r - box.l, d = Math.max(rx + 1, depth * (DEEP[kind] ?? 0)), s = Math.min(1, Math.max(0, soft));
  if (!(kind in DEEP) || !(depth > 0)) return '';
  const at = (k, amount) => 1 + vary(seed, k) * amount;
  if (kind === 'slope') return corner(box, -1, 1, SPAN.slope * w * at('a', 0.15), d * at('b', 0.15), rx, s, 0.5);
  if (kind === 'twin') return corner(box, 1, 1, SPAN.twin * w * at('a', 0.15), d * at('b', 0.15), rx, s, 0.4) + corner(box, -1, 1, SPAN.twin * w * at('c', 0.15), d * at('d', 0.15), rx, s, 0.4);
  if (kind === 'ring') return [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy], k) => corner(box, sx, sy, d * 2.4 * at(`r${k}`, 0.15), d * at(`s${k}`, 0.1), rx, s, 0.5)).join('');
  const half = SPAN[kind] * w * at('a', 0.1), xm = box.l + w / 2 + vary(seed, 'x') * (w / 2 - half - rx) * 0.4;
  return lens(box.t, xm, half, Math.min(d * at('b', 0.1), d), s, SHARP[kind]);
}

/** How deep a cut may reach: the style's depth (shared by phase if it grows), kept above the name's top by `clear`. */
export function depthFor({ depth, clear, grow, phase, h, lines, line }) {
  const cap = (h - lines * line) / 2 - clear, want = depth * (grow ? GROWN[phase] ?? 1 : 1);
  return Math.max(0, Math.min(want, cap));
}
