// Every face made a rectangle (task e_7vp7udzk), so the grid can be read off the shape by order alone: Tamassia's
// refinement. Each picture is first set in a frame, joined to it by one stretch out of its outer face; then, while a face
// has a corner that turns out of it followed by two that turn into it, a stretch is drawn on from that corner to the
// side beyond them, cutting off a rectangle. Every face that has such a corner has such a run of three. The stretches
// added are only for reading the grid; nothing drawn keeps them. Layer: shape. Pure: the graph in, changed in place.

import { QUARTERS } from './sides.js';

/** Darts of the graph: 2s runs stretch s from a to b, 2s + 1 back. */
const tailOf = (g, d) => (d % 2 ? g.stretches[d >> 1].b : g.stretches[d >> 1].a);
const headOf = (g, d) => (d % 2 ? g.stretches[d >> 1].a : g.stretches[d >> 1].b);
const headingOf = (g, d) => (g.stretches[d >> 1].h + (d % 2 ? 2 : 0)) % QUARTERS;
const leavingAt = (g, v, s) => (g.stretches[s].a === v ? s * 2 : s * 2 + 1);

/** The next dart round the face on the left of `d`, and the quarters of the angle between them. */
export function step(g, d) {
  const v = headOf(g, d), back = (headingOf(g, d) + 2) % QUARTERS;
  for (let i = 1; i <= QUARTERS; i++) {
    const s = g.slots[v][(back + i) % QUARTERS];
    if (s >= 0) return { next: leavingAt(g, v, s), angle: i };
  }
  throw new Error('shape: a point with no stretch');
}

/** The face on the left of `d`: its darts and the turn at the head of each (below zero into the face). */
export function faceFrom(g, d) {
  const darts = [], turns = [];
  let x = d;
  do {
    const { next, angle } = step(g, x);
    darts.push(x);
    turns.push(angle - 2);
    x = next;
  } while (x !== d);
  return { darts, turns, sum: turns.reduce((s, t) => s + t, 0) };
}

/** Every face of the graph, each once. */
export function allFaces(g) {
  const seen = new Uint8Array(g.stretches.length * 2), out = [];
  for (let d = 0; d < seen.length; d++) {
    if (seen[d]) continue;
    const f = faceFrom(g, d);
    for (const x of f.darts) seen[x] = 1;
    out.push(f);
  }
  return out;
}

/** Split stretch s at a new point, keeping each edge's chain of points; answers the point. */
function split(g, s, chain) {
  const st = g.stretches[s], t = g.point({ cut: true }), b = st.b, rest = g.stretches.length;
  g.stretches.push({ ...st, a: t, b });
  g.slots[b][(st.h + 2) % QUARTERS] = rest;
  g.slots[t][st.h] = rest;
  g.slots[t][(st.h + 2) % QUARTERS] = s;
  st.b = t;
  if (st.edge !== undefined) {
    const c = chain[st.edge], i = c.findIndex((p, j) => (p === st.a && c[j + 1] === b) || (p === b && c[j + 1] === st.a));
    c.splice(i + 1, 0, t);
  }
  return t;
}

/** A frame round the face on the left of `d`, an outer face, joined to it by one stretch out of a wide corner. */
function frame(g, outer) {
  const i = outer.turns.findIndex((t) => t >= 0), d = outer.darts[i];
  const v = headOf(g, d), out = (headingOf(g, d) + 2 + 1) % QUARTERS, f0 = g.point({ frame: true });
  g.join(v, f0, out, { frame: true });
  // f0 stands on a side of the frame: along it a quarter on, round the four corners, and back into f0 the same way.
  const ways = [1, 2, 2 + 1, 0, 1];
  let p = f0;
  ways.forEach((w, k) => {
    const q = k === ways.length - 1 ? f0 : g.point({ frame: true });
    g.join(p, q, (out + w) % QUARTERS, { frame: true });
    p = q;
  });
  return f0;
}

/**
 * A cut for face `f`: from a corner that turns out of it, past the next two that turn into it, on to the side beyond
 * them, or the same the other way round the face. An upright cut first, so that what stands side by side is ordered
 * only across, never down. Answers { v, heading, front }, the dart whose stretch it meets, or null.
 */
function cutOf(g, f) {
  const m = f.darts.length, seek = (from, by) => { for (let j = 1; j < m; j++) { const at = (from + by * j + m * m) % m; if (f.turns[at] !== 0) return at; } return -1; };
  let level = null;
  for (let i = 0; i < m; i++) {
    const t = f.turns[i];
    if (t <= 0) continue;
    const d = f.darts[i], v = headOf(g, d), hIn = headingOf(g, d), found = [];
    const a1 = seek(i, 1), a2 = a1 >= 0 ? seek(a1, 1) : -1;
    if (a2 >= 0 && f.turns[a1] === -1 && f.turns[a2] === -1) {
      const heading = (hIn + t - 1 + QUARTERS) % QUARTERS;
      found.push({ v, heading, front: f.darts[(a2 + 1) % m], meets: (heading + QUARTERS - 1) % QUARTERS });
    }
    const b1 = seek(i, -1), b2 = b1 >= 0 ? seek(b1, -1) : -1;
    if (b2 >= 0 && f.turns[b1] === -1 && f.turns[b2] === -1) {
      const heading = (hIn + QUARTERS - 1) % QUARTERS;
      found.push({ v, heading, front: f.darts[b2], meets: (heading + QUARTERS - 1) % QUARTERS });
    }
    for (const c of found) {
      if (headingOf(g, c.front) !== c.meets) throw new Error('shape: a cut that meets its side askew');
      if (c.heading % 2 === 0) return c;
      level ??= c;
    }
  }
  return level;
}

/** Make every inner face a rectangle, after framing each picture's outer face. */
export function refine(g, chain) {
  for (const f of allFaces(g)) if (f.sum > 0) frame(g, f);
  const work = allFaces(g).filter((f) => f.sum < 0 && f.turns.some((t) => t > 0));
  while (work.length) {
    // Read again: a cut next door may have split one of its sides since it was put here.
    const f = faceFrom(g, work.pop().darts[0]);
    const cut = cutOf(g, f);
    if (!cut) throw new Error('shape: a face that cannot be cut to rectangles');
    const t = split(g, cut.front >> 1, chain), s = g.join(cut.v, t, cut.heading, { cut: true });
    for (const x of [s * 2, s * 2 + 1]) {
      const next = faceFrom(g, x);
      if (next.sum < 0 && next.turns.some((tt) => tt > 0)) work.push(next);
    }
  }
}

export { tailOf, headOf, headingOf };
