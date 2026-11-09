// What a finished picture does well, read off it (task e_tgmq6ffu): numbers that track what the owner values in a flow
// picture (right angles, order running down, wires that do not wander, no ribbons, names readable, stability), each
// read from the picture alone, so every layout is scored alike. Crossings are a footnote: a layout with a quarter of
// another's read far worse (e_4zfxftyg). Pure: pictures in, numbers out.

import { type Box, type Picture, type Wire } from './read.ts';

/** The screen a whole view is fitted to, and the least size a name is read at on it. */
export const SCREEN = { width: 1600, height: 1000, readable: 9 };

const len = (p: number[][]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const straight = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5;

/**
 * Order wires that run up, against the order, and on which side of their two boxes each comes back: `up` of `order`,
 * `left` and `right`, and `oneSide` when every one comes back on the same side. A wire runs up when its head's box
 * stands wholly above its tail's, or it comes up into it.
 */
export function upward(pic: Picture) {
  const at = new Map(pic.boxes.map((b) => [b.id, b]));
  const order = pic.wires.filter((w) => w.order && w.a && w.b && at.has(w.a) && at.has(w.b));
  let up = 0, left = 0, right = 0;
  for (const w of order) {
    const [a, b, p] = [at.get(w.a!)!, at.get(w.b!)!, w.points];
    const rising = b.u <= a.t || (b.t < a.u && p.at(-1)![1] < p.at(-2)![1] && a.t < b.t);
    if (!rising) continue;
    up++;
    // The side it comes back on: where its longest upright stretch stands against the middle of its two boxes.
    let x = (p[0][0] + p.at(-1)![0]) / 2, most = -1;
    p.slice(1).forEach((q, i) => { if (Math.abs(q[0] - p[i][0]) < 0.5 && Math.abs(q[1] - p[i][1]) > most) [x, most] = [q[0], Math.abs(q[1] - p[i][1])]; });
    if (x < ((a.l + a.r) / 2 + (b.l + b.r) / 2) / 2) left++; else right++;
  }
  return { order: order.length, up, left, right, oneSide: left === 0 || right === 0 };
}

/** Bends per wire (`mean`, `most`), and `slanted`: wires with a stretch that is not at a right angle. */
export function bends(pic: Picture) {
  const each = pic.wires.map((w) => w.points.length - 2);
  return { mean: mean(each), most: Math.max(0, ...each), slanted: pic.wires.filter((w) => w.points.slice(1).some((q, i) => !straight(q, w.points[i]))).length };
}

/** How far wires wander: each wire's length over the shortest right-angle path between its ends, `mean` and `most`. */
export function detour(pic: Picture) {
  const each = pic.wires.map((w) => {
    const [a, b] = [w.points[0], w.points.at(-1)!], least = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    return least > 1 ? len(w.points) / least : null;
  }).filter((d): d is number => d !== null);
  return { mean: mean(each), most: Math.max(1, ...each) };
}

/**
 * Ribbons: the most wires side by side at any one place, each within `gap` of the next across the way they run. Wires
 * on one line (a shared trunk) are one; stretches shorter than `gap` are left out, so a jog makes no ribbon.
 */
export function ribbon(pic: Picture, gap: number) {
  let most = 0, where: number[] = [0, 0];
  for (const ax of [0, 1]) {
    // ax 0: upright stretches, at x, spanning y; ax 1: level ones, at y, spanning x.
    const runs = pic.wires.flatMap((w) => w.points.slice(1).flatMap((q, i) => {
      const p = w.points[i];
      if (Math.abs(p[ax] - q[ax]) >= 0.5) return [];
      const lo = Math.min(p[1 - ax], q[1 - ax]), hi = Math.max(p[1 - ax], q[1 - ax]);
      return hi - lo < gap ? [] : [{ at: p[ax], lo, hi }];
    }));
    const cuts = [...new Set(runs.flatMap((r) => [r.lo + 1, (r.lo + r.hi) / 2, r.hi - 1]))];
    for (const c of cuts) {
      const xs = [...new Set(runs.filter((r) => r.lo <= c && c <= r.hi).map((r) => Math.round(r.at * 2) / 2))].sort((p, q) => p - q);
      let n = 1;
      for (let i = 0; i < xs.length; i++) {
        n = i && xs[i] - xs[i - 1] <= gap ? n + 1 : 1;
        if (n > most) [most, where] = [n, ax ? [c, xs[i]] : [xs[i], c]];
      }
    }
  }
  return { most, where };
}

/** Names as read with the whole view fitted to the screen: `share` readable (drawn at least SCREEN.readable px and whole), `cut`, `small`, the fit's `scale`, and `px`, how large a step's name is drawn then. */
export function names(pic: Picture, screen = SCREEN) {
  const scale = Math.min(1, screen.width / Math.max(1, pic.width), screen.height / Math.max(1, pic.height));
  const small = pic.names.filter((n) => n.px * scale < screen.readable).length, cut = pic.names.filter((n) => n.cut).length;
  const readable = pic.names.filter((n) => n.px * scale >= screen.readable && !n.cut).length;
  const px = pic.names.length ? Math.max(...pic.names.map((n) => n.px)) * scale : 0;
  return { share: pic.names.length ? readable / pic.names.length : 1, cut, small, scale, px };
}

/**
 * How far items move from `before` to `after`, the same view with one item added: each item both draw, after the
 * picture is brought back by the shift most items made (the median), so a picture that only grew does not count as
 * moved. `mean` in px, and `share` that moved more than `far`.
 */
export function moved(before: Picture, after: Picture, far = 16) {
  const was = new Map(before.boxes.map((b) => [b.id, b])), mid = (b: Box) => [(b.l + b.r) / 2, (b.t + b.u) / 2];
  const pairs = after.boxes.filter((b) => was.has(b.id)).map((b) => [mid(was.get(b.id)!), mid(b)]);
  if (!pairs.length) return { mean: 0, share: 0, items: 0 };
  const median = (xs: number[]) => xs.sort((p, q) => p - q)[Math.floor(xs.length / 2)];
  const [dx, dy] = [0, 1].map((k) => median(pairs.map(([p, q]) => q[k] - p[k])));
  const each = pairs.map(([p, q]) => Math.hypot(q[0] - dx - p[0], q[1] - dy - p[1]));
  return { mean: mean(each), share: each.filter((d) => d > far).length / each.length, items: each.length };
}

/** Wires that pass through a box that is not one of their ends, a fault the eye reads as a wire hidden under a step. */
export function through(pic: Picture) {
  let n = 0;
  for (const w of pic.wires) {
    const ends = new Set([w.a, w.b]);
    const hit = pic.boxes.some((b) => !ends.has(b.id) && w.points.slice(1).some((q, i) => crosses(b, w.points[i], q)));
    if (hit) n++;
  }
  return n;
}

/** Whether the stretch a to b passes inside box `b`, past a margin of 1 px. */
function crosses(b: Box, p: number[], q: number[]) {
  const inner = { ...b, l: b.l + 1, r: b.r - 1, t: b.t + 1, u: b.u - 1 };
  if (inner.l >= inner.r || inner.t >= inner.u) return false;
  const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 4);
  for (let k = 0; k <= steps; k++) {
    const t = steps ? k / steps : 0, at = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    if (at[0] > inner.l && at[0] < inner.r && at[1] > inner.t && at[1] < inner.u) return true;
  }
  return false;
}

export type Measures = ReturnType<typeof measure>;

/** Every measure of one picture but those that need a second drawing (moved) or a clock. `seen` is count.js's crossings as the eye meets them. */
export function measure(pic: Picture, { gap, seen }: { gap: number; seen: (lines: number[][][]) => number }) {
  return {
    items: pic.boxes.length, wires: pic.wires.length, size: [Math.round(pic.width), Math.round(pic.height)],
    upward: upward(pic), bends: bends(pic), detour: detour(pic), ribbon: ribbon(pic, gap), names: names(pic), through: through(pic),
    seen: seen(pic.wires.map((w: Wire) => w.points)),
  };
}
