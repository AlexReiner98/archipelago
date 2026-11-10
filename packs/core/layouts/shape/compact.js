// The grid read off a shape whose faces are all rectangles (task e_7vp7udzk), Tamassia's way: on each axis, every
// stretch that runs along it is at least one long, each face's two opposite sides are as long as each other, and of
// all such lengths the flow over the faces finds those that keep the wires shortest. So boxes that hang from one box
// stand in one row rather than down a stair, and nothing is longer than it must be. The grid keeps the order and the
// ways; the relaxation sets the distances. Pictures apart are set side by side. Layer: shape. Pure: the graph and its
// faces in, integer places out.

import { minCostFlow } from './flow.js';
import { allFaces } from './refine.js';

/** What a unit of length costs: a wire's or a border's; a box's side, an unseen edge or a stretch drawn only for the
 *  grid, nothing. */
const cost = (s) => (s.edge !== undefined && !s.unseen ? 1 : 0);

/** Each point's place on one axis: `upright` the stretches that run along it (N and S, for y). */
function along(g, faceOf, nFaces, upright, batch) {
  const forward = upright ? 2 : 1, arcs = [], which = [];
  g.stretches.forEach((s, i) => {
    if ((s.h % 2 === 0) !== upright) return;
    // The dart running forward (down, or right) has on its left the face after it (east, or north) in turn.
    const d = s.h === forward ? i * 2 : i * 2 + 1, before = faceOf[d ^ 1], after = faceOf[d];
    which.push([i, s.h === forward]);
    arcs.push(upright ? { from: before, to: after, low: 1, cost: cost(s) } : { from: after, to: before, low: 1, cost: cost(s) });
  });
  const { flow } = minCostFlow(nFaces, new Array(nFaces).fill(0), arcs, { batch });
  const length = new Map(which.map(([i, fwd], j) => [i, fwd ? flow[j] : -flow[j]]));
  const at = new Array(g.slots.length).fill(null);
  for (let start = 0; start < at.length; start++) {
    if (at[start] !== null) continue;
    at[start] = 0;
    const stack = [start];
    while (stack.length) {
      const v = stack.pop();
      for (const i of g.slots[v]) {
        if (i < 0) continue;
        const s = g.stretches[i], u = s.a === v ? s.b : s.a, sign = s.a === v ? 1 : -1;
        if (at[u] !== null) continue;
        at[u] = at[v] + ((s.h % 2 === 0) === upright ? sign * length.get(i) : 0);
        stack.push(u);
      }
    }
  }
  return at;
}

/** Integer places for every point: { x, y }, each picture apart moved right of the one before. */
export function compact(g, batch = Infinity) {
  const faces = allFaces(g), faceOf = new Int32Array(g.stretches.length * 2);
  faces.forEach((f, i) => { for (const d of f.darts) faceOf[d] = i; });
  const x = along(g, faceOf, faces.length, false, batch), y = along(g, faceOf, faces.length, true, batch), n = g.slots.length;
  const root = Array.from({ length: n }, (_, v) => v), find = (v) => (root[v] === v ? v : (root[v] = find(root[v])));
  for (const s of g.stretches) root[find(s.a)] = find(s.b);
  const groups = new Map();
  for (let v = 0; v < n; v++) (groups.get(find(v)) ?? groups.set(find(v), []).get(find(v))).push(v);
  let left = 0;
  for (const members of groups.values()) {
    const lo = Math.min(...members.map((v) => x[v])), hi = Math.max(...members.map((v) => x[v])), top = Math.min(...members.map((v) => y[v]));
    for (const v of members) { x[v] += left - lo; y[v] -= top; }
    left += hi - lo + 1;
  }
  return { x, y };
}
