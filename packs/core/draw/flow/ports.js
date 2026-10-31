// Each wire landing on one side of a box, evenly about its middle. It serves a step put by hand, until the solve does. Pure:
// boxes and lines in, changed in place.

import { tidy } from './polyline.js';
import { clear, shapesOf } from './reroute.js';

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
    // What comes to a point shares one arrival there.
    // And so does more than a side can hold apart: one bus into one arrival, not a squeeze.
    const packed = b.pointed || (ends.length - 1) * gap > hi - lo - 2 * pad;
    const step = ends.length > 1 && !packed ? gap : 0, mid = (lo + hi) / 2, mates = new Set(ends.map((e) => e.w));
    ends.sort((p, q) => p.at - q.at);
    ends.forEach((end, n) => {
      const want = mid + (n - (ends.length - 1) / 2) * step, was = tidy(end.w.points), k = end.k === 0 ? 0 : was.length - 1, near = end.k === 0 ? 1 : was.length - 2, line = was.map((p) => [...p]);
      if (Math.abs(line[k][ax] - want) < 0.5) return;
      line[k][ax] = want;
      line[near][ax] = want;
      const done = tidy(line);
      if (clear(done, was, end.w, shape.solids, others, 0, 0, packed ? mates : null)) ((end.w.points = done), (end.w.bounds = null));
    });
  }
}
