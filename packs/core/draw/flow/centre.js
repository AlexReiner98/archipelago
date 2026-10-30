// Straight runs through the middle of their boxes, once the wires have their routes. A chain of boxes joined one to the
// next stands on one line, a box that feeds several stands over them, and each wire on one side of a box lands evenly
// about its middle. A box moves only if nothing stands in its way, with what hangs on it; a wire's other ends move with
// it. Pure: boxes and lines in, changed in place.

import { clear, shapesOf, tidy } from './reroute.js';

const LEVEL = 0.5;

/** Each wire between two boxes that stand one above the other, joined by a stretch down or by one step across. */
function links(wires, shape) {
  const out = [];
  for (const w of wires) {
    const a = shape.get(w.a), b = shape.get(w.b);
    if (!a || !b) continue;
    const [upper, lower, line] = a.mid[1] <= b.mid[1] ? [w.a, w.b, tidy(w.points)] : [w.b, w.a, tidy(w.points).reverse()];
    if (shape.get(upper).hi[1] > shape.get(lower).lo[1]) continue;
    const down = line.length === 2 && line[0][0] === line[1][0], step = line.length === 4 && line[0][0] === line[1][0] && line[2][0] === line[3][0];
    if (down || step) out.push({ w, upper, lower });
  }
  return out;
}

/** Where each box of one joined set should stand across: a chain on the median of its boxes, a box that feeds others over them. */
function targets(members, downs, ups, mid) {
  const line = members.every((id) => (downs.get(id)?.length ?? 0) <= 1 && (ups.get(id)?.length ?? 0) <= 1), at = new Map();
  if (line) {
    const xs = members.map(mid).sort((p, q) => p - q), x = xs[(xs.length - 1) >> 1];
    for (const id of members) at.set(id, x);
    return at;
  }
  const lowest = [...members].sort((p, q) => mid(p) - mid(q));
  const place = (id) => {
    if (at.has(id)) return at.get(id);
    at.set(id, mid(id));
    const below = downs.get(id) ?? [];
    if (below.length) at.set(id, below.reduce((sum, k) => sum + place(k), 0) / below.length);
    return at.get(id);
  };
  lowest.forEach(place);
  return at;
}

/** A wire with the end on a box moved by `dx`, at right angles still. */
function slid(points, atEnd, dx) {
  const line = atEnd ? [...points].reverse() : points, out = line.map((p) => [...p]);
  out[0][0] += dx;
  if (out[1] && line[1][0] === line[0][0]) out[1][0] += dx;
  return atEnd ? out.reverse() : out;
}

/**
 * Stand joined boxes in line. `shift(id, dx)` moves a box with what hangs on it, in whoever holds its place; `still` are
 * lines to keep off. Answers with the wires it moved.
 */
export function centre(boxes, wires, still, { track, room, gap, corner, shift }) {
  const moved = new Set();
  let shape = shapesOf(boxes, track);
  const joined = links(wires, shape), root = new Map(), downs = new Map(), ups = new Map();
  const find = (v) => { let r = v; while (root.has(r)) r = root.get(r); return r; };
  // A step across only counts where it is the one wire on that side of each box: else it is no chain.
  const ends = new Map(), key = (id, foot) => `${id} ${foot}`;
  for (const { upper, lower } of joined) for (const k of [key(upper, 1), key(lower, 0)]) ends.set(k, (ends.get(k) ?? 0) + 1);
  for (const { upper, lower } of joined) {
    (downs.get(upper) ?? downs.set(upper, []).get(upper)).push(lower);
    (ups.get(lower) ?? ups.set(lower, []).get(lower)).push(upper);
    if (find(upper) !== find(lower)) root.set(find(upper), find(lower));
  }
  const sets = new Map();
  for (const id of [...new Set(joined.flatMap((j) => [j.upper, j.lower]))].sort()) (sets.get(find(id)) ?? sets.set(find(id), []).get(find(id))).push(id);
  for (const members of sets.values()) {
    const mid = (id) => shape.get(id).mid[0], at = targets(members, downs, ups, mid), moves = members.filter((id) => Math.abs(at.get(id) - mid(id)) > LEVEL);
    const own = joined.filter((j) => members.includes(j.upper));
    const stale = own.filter(({ w }) => tidy(w.points).length !== 2 || Math.abs(mid(w.a) - mid(w.b)) > LEVEL);
    if (!moves.length && !stale.length) continue;
    for (const id of moves) boxes.get(id).at[0] += at.get(id) - mid(id);
    const after = shapesOf(boxes, track), solids = after.solids, lines = new Map(), others = [...wires, ...still.map((points) => ({ points }))];
    let free = true;
    // No box of the set may stand on another box.
    for (const id of moves) {
      const b = after.get(id);
      for (const s of solids) if (s.id !== id && !members.includes(s.id) && b.hi[0] + room > s.l && b.lo[0] - room < s.r && b.hi[1] > s.t && b.lo[1] < s.u) free = false;
    }
    for (const w of wires) {
      const a = moves.includes(w.a), b = moves.includes(w.b), link = own.find((j) => j.w === w);
      if (link) {
        const [u, v] = [after.get(link.upper), after.get(link.lower)], lo = Math.max(u.lo[0], v.lo[0]) + Math.min(corner, (u.hi[0] - u.lo[0]) / 3), hi = Math.min(u.hi[0], v.hi[0]) - Math.min(corner, (v.hi[0] - v.lo[0]) / 3);
        if (lo > hi) { free = false; continue; }
        const x = Math.min(hi, Math.max(lo, (at.get(link.upper) + at.get(link.lower)) / 2)), line = [[x, u.hi[1]], [x, v.lo[1]]];
        lines.set(w, w.a === link.upper ? line : line.reverse());
      } else if (a || b) {
        let line = w.points;
        if (a) line = slid(line, false, at.get(w.a) - mid(w.a));
        if (b) line = slid(line, true, at.get(w.b) - mid(w.b));
        lines.set(w, line);
      }
    }
    for (const [w, line] of lines) if (free && !clear(tidy(line), tidy(w.points), w, solids, others.filter((v) => !lines.has(v)), 0, 0)) free = false;
    if (!free) {
      for (const id of moves) boxes.get(id).at[0] -= at.get(id) - mid(id);
      continue;
    }
    for (const id of moves) {
      const dx = at.get(id) - mid(id);
      boxes.get(id).at[0] -= dx;
      shift(id, dx);
    }
    for (const [w, line] of lines) ((w.points = line), (w.bounds = null), moved.add(w));
    shape = shapesOf(boxes, track);
  }
  return [...moved];
}

/** Each wire landing on one side of a box, evenly about its middle, `gap` apart or as near as the side lets them. */
export function spreadPorts(boxes, wires, still, { track, gap, corner }) {
  const shape = shapesOf(boxes, track), sides = new Map();
  for (const w of wires) {
    const line = tidy(w.points);
    if (line.length < 3) continue;
    for (const [id, p, q, k] of [[w.a, line[0], line[1], 0], [w.b, line.at(-1), line.at(-2), line.length - 1]]) {
      const ax = p[0] === q[0] ? 0 : 1, s = `${id} ${ax} ${Math.sign(q[1 - ax] - p[1 - ax])}`;
      (sides.get(s) ?? sides.set(s, { id, ax, ends: [] }).get(s)).ends.push({ w, k, line, at: p[ax], far: q[ax === 0 ? 1 : 0] });
    }
  }
  const others = [...wires, ...still.map((points) => ({ points }))];
  for (const { id, ax, ends } of sides.values()) {
    const b = shape.get(id), [lo, hi] = [b.lo[ax], b.hi[ax]], pad = Math.min(corner, (hi - lo) / 3);
    if (b.pointed && ends.length > 1) continue;
    const step = ends.length > 1 ? Math.min(gap, (hi - lo - 2 * pad) / (ends.length - 1)) : 0, mid = (lo + hi) / 2;
    ends.sort((p, q) => p.at - q.at);
    ends.forEach((end, n) => {
      const want = mid + (n - (ends.length - 1) / 2) * step, was = tidy(end.w.points), k = end.k === 0 ? 0 : was.length - 1, near = end.k === 0 ? 1 : was.length - 2, line = was.map((p) => [...p]);
      if (Math.abs(line[k][ax] - want) < 0.5) return;
      line[k][ax] = want;
      line[near][ax] = want;
      const done = tidy(line);
      if (clear(done, was, end.w, shape.solids, others, 0, 0)) ((end.w.points = done), (end.w.bounds = null));
    });
  }
}
