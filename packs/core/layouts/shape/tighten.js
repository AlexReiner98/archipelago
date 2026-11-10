// The grid drawn tight once the cuts are gone (task e_7vp7udzk). The cuts that made every face a rectangle put things in
// an order they need not keep: boxes that hang from one box would stand down a stair. So the frame and the cuts are
// dropped, and the unseen edges that only hold the faces, and each axis in turn is moved as far as it will go, keeping in order only what faces each other across it:
// two things that overlap on x keep their order on y, and the other way about. Every place stays drawable, since what
// could meet keeps its order. Layer: shape. Pure: the graph and places in, places out.

import { QUARTERS } from './sides.js';

/** Points joined by a stretch of `level` (horizontal, for y) share a line; each line's things are its stretches and points. */
function lineOf(g, real, level) {
  const n = g.slots.length, root = Array.from({ length: n }, (_, v) => v), find = (v) => (root[v] === v ? v : (root[v] = find(root[v])));
  g.stretches.forEach((s, i) => { if (real[i] && (s.h % 2 === 1) === level) root[find(s.a)] = find(s.b); });
  return Array.from({ length: n }, (_, v) => find(v));
}

/** Move one axis: `pos` the places on it, `other` the places across. Answers new places. */
function squeeze(g, real, drawn, pos, other, level, pulled) {
  const line = lineOf(g, real, level), things = [];
  // A stretch that keeps a line spans the other axis between its ends; a point spans just its place.
  // The step aside in a neck spans its box too, so it keeps a row of its own beside the box rather than share one with
  // what stands under the box, which would hold the neck, and the box, wide.
  const span = new Map();
  g.what.forEach((w, v) => {
    if (w.corner === undefined) return;
    const [lo, hi] = span.get(w.node) ?? [Infinity, -Infinity];
    span.set(w.node, [Math.min(lo, other[v]), Math.max(hi, other[v])]);
  });
  const necked = new Map();
  g.stretches.forEach((s, i) => {
    if (!real[i] || (s.h % 2 === 1) !== level) return;
    const [lo, hi] = (s.neck !== undefined && span.get(s.neck)) || [Infinity, -Infinity];
    if (s.neck !== undefined) necked.set(line[s.a], s.from);
    things.push([line[s.a], Math.min(other[s.a], other[s.b], lo), Math.max(other[s.a], other[s.b], hi)]);
  });
  // A loose point stands on its box's side wherever its box puts it: it is in nothing's way and takes no place of its
  // own, so what is either side of it along the side is ordered past it.
  const free = drawn.filter((v) => loose(g, real, v, level)), isFree = new Set(free), placed = drawn.filter((v) => !isFree.has(v));
  placed.forEach((v) => things.push([line[v], other[v], other[v]]));
  const beyond = (v, h) => { while (isFree.has(v)) { const s = g.stretches[g.slots[v][h]]; v = s.a === v ? s.b : s.a; } return v; };
  const after = new Map(), add = (p, q) => { if (p !== q) (after.get(p) ?? after.set(p, new Set()).get(p)).add(q); };
  g.stretches.forEach((s, i) => {
    if (!real[i] || (s.h % 2 === 1) === level || isFree.has(s.a)) return;
    const q = beyond(s.b, s.h), ahead = s.h === 1 || s.h === 2;
    add(line[ahead ? s.a : q], line[ahead ? q : s.a]);
  });
  // A neck's line stands nearer its box than what is level with it, so it never shares that row.
  const placeOf = new Map(), half = 1 / 2, before = level ? 0 : QUARTERS - 1;
  for (const v of placed) placeOf.set(line[v], pos[v] + (necked.has(line[v]) ? (necked.get(line[v]) === before ? half : -half) : 0));
  // The lines in order: what overlaps another across the axis stands before it if its place is less (by line, if the same).
  const lines = [...placeOf.keys()].sort((a, b) => placeOf.get(a) - placeOf.get(b) || a - b);
  // A box's near side, the necks that queue before it, and the steps aside of necks that leave its near side are drawn
  // up to what follows them, so the box is as narrow as its wires let it be and a neck stays by its box.
  const pull = new Set([...drawn.filter(pulled).map((v) => line[v]), ...[...necked].filter(([, from]) => from === before).map(([l]) => l)]);
  const next = things.every((t) => placeOf.has(t[0])) && [...after].every(([p, qs]) => placeOf.has(p) && [...qs].every((q) => placeOf.has(q)))
    ? swept(things, lines, after, pull)
    : paired(things, lines, after, pull, placeOf, add);
  for (const v of free) {
    const h = g.slots[v].findIndex((i) => i >= 0 && g.stretches[i].cage !== undefined && g.stretches[i].a === v);
    next.set(line[v], next.get(line[beyond(v, h)]));
  }
  return pos.map((p, v) => (next.has(line[v]) ? next.get(line[v]) : p));
}

/**
 * Each line's least place, `things` ([line, from, to] across the axis) paired one with another where they overlap,
 * each pair an order (`add`) in `lines`' order: one past the furthest of what comes before, then each line `pull`
 * names drawn up to one before the nearest of what follows. Every pair is looked at, so it takes the square of the
 * things: kept for a line that has no place, which `swept` cannot order.
 */
export function paired(things, lines, after, pull, placeOf, add) {
  things.sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < things.length; i++) {
    for (let j = i + 1; j < things.length && things[j][1] <= things[i][2]; j++) {
      const [a, b] = [things[i][0], things[j][0]];
      if (a === b) continue;
      if (placeOf.get(a) < placeOf.get(b) || (placeOf.get(a) === placeOf.get(b) && a < b)) add(a, b); else add(b, a);
    }
  }
  const next = new Map();
  for (const l of lines) next.set(l, 0);
  for (const l of lines) for (const q of after.get(l) ?? []) next.set(q, Math.max(next.get(q), next.get(l) + 1));
  for (const l of [...lines].reverse()) {
    const later = [...(after.get(l) ?? [])].map((q) => next.get(q));
    if (pull.has(l) && later.length) next.set(l, Math.min(...later) - 1);
  }
  return next;
}

/**
 * Across the axis, from what each part of it holds: `give(from, to, value)` keeps the most (`better` says which is
 * more) of what has been given over any place in it, `best(from, to)` the most given anywhere it overlaps. A tree of
 * halves: nothing pushed down, since giving only ever raises.
 */
function spans(size, worst, better) {
  const at = new Float64Array(4 * size).fill(worst), all = new Float64Array(4 * size).fill(worst);
  const give = (lo, hi, value, node = 1, l = 0, r = size - 1) => {
    if (hi < l || r < lo) return;
    at[node] = better(at[node], value);
    if (lo <= l && r <= hi) return void (all[node] = better(all[node], value));
    const mid = (l + r) >> 1;
    (give(lo, hi, value, node * 2, l, mid), give(lo, hi, value, node * 2 + 1, mid + 1, r));
  };
  const best = (lo, hi, node = 1, l = 0, r = size - 1) => {
    if (hi < l || r < lo) return worst;
    if (lo <= l && r <= hi) return at[node];
    const mid = (l + r) >> 1;
    return better(all[node], better(best(lo, hi, node * 2, l, mid), best(lo, hi, node * 2 + 1, mid + 1, r)));
  };
  return { give, best };
}

/**
 * What `paired` answers, without pairing (bug e_a9w5jeme: 330,000 pairs a call on 263 items, eight calls a picture).
 * The lines are taken in order; each line's least place is one past the furthest of the lines before it that overlap
 * it (asked of a tree over the axis) and of the orders `after` gave it, and is then given over its own stretches. Then
 * back, each pulled line drawn up to one before the nearest of what follows: the overlaps asked of a second tree.
 */
export function swept(things, lines, after, pull) {
  const ends = [...new Set(things.flatMap((t) => [t[1], t[2]]))].sort((a, b) => a - b), index = new Map(ends.map((x, i) => [x, i]));
  const spansOf = new Map();
  for (const [l, lo, hi] of things) (spansOf.get(l) ?? spansOf.set(l, []).get(l)).push([index.get(lo), index.get(hi)]);
  const next = new Map(), owed = new Map(), most = spans(ends.length, -Infinity, Math.max);
  for (const l of lines) {
    let v = Math.max(0, owed.get(l) ?? 0);
    for (const [lo, hi] of spansOf.get(l)) v = Math.max(v, most.best(lo, hi) + 1);
    next.set(l, v);
    for (const [lo, hi] of spansOf.get(l)) most.give(lo, hi, v);
    // An order from the stretches: to a line not yet taken, it is owed; to one taken, it raises it as it stands.
    for (const q of after.get(l) ?? []) next.has(q) ? next.set(q, Math.max(next.get(q), v + 1)) : owed.set(q, Math.max(owed.get(q) ?? 0, v + 1));
  }
  const least = spans(ends.length, Infinity, Math.min);
  for (const l of [...lines].reverse()) {
    if (pull.has(l)) {
      let low = Infinity;
      for (const [lo, hi] of spansOf.get(l)) low = Math.min(low, least.best(lo, hi));
      for (const q of after.get(l) ?? []) low = Math.min(low, next.get(q));
      if (low < Infinity) next.set(l, low - 1);
    }
    for (const [lo, hi] of spansOf.get(l)) least.give(lo, hi, next.get(l));
  }
  return next;
}

/** Whether point v stands on a box's side with nothing drawn leaving it across `level`'s axis (the end of an unseen
 *  edge, or where a cut met the side): it holds nothing in place, and goes wherever its box puts it. */
const loose = (g, real, v, level) => {
  const s = g.slots[v], across = level ? [1, QUARTERS - 1] : [0, 2];
  return across.every((h) => s[h] < 0 || !real[s[h]]) && s.some((i) => i >= 0 && g.stretches[i].cage !== undefined);
};

/** Whether point v of a box is drawn up to what follows it: a corner on its near side (`a`, `b`), or a neck that queues
 *  before the box. */
const near = (g, v, level, a, b) => {
  const w = g.what[v];
  return w.corner === a || w.corner === b || w.jog === (level ? 0 : QUARTERS - 1);
};

/** Places for the points that are drawn, the cuts and frame dropped and each axis moved in turn, `rounds` times. */
export function tighten(g, x, y, rounds = 2) {
  const real = g.stretches.map((s) => !s.cut && !s.frame && !s.unseen), drawn = [];
  g.slots.forEach((slots, v) => { if (slots.some((i) => i >= 0 && real[i])) drawn.push(v); });
  for (let r = 0; r < rounds; r++) {
    y = squeeze(g, real, drawn, y, x, true, (v) => near(g, v, true, 0, 1));
    x = squeeze(g, real, drawn, x, y, false, (v) => near(g, v, false, 0, QUARTERS - 1));
  }
  return { x, y };
}
