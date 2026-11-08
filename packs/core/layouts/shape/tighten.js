// The grid drawn tight once the cuts are gone (task e_7vp7udzk). The cuts that made every face a rectangle put things in
// an order they need not keep: boxes that hang from one box would stand down a stair. So the frame and the cuts are
// dropped, and the unseen edges that only hold the faces, and each axis in turn is moved as far as it will go, keeping in order only what faces each other across it:
// two things that overlap on x keep their order on y, and the other way about. Every place stays drawable, since what
// could meet keeps its order. Layer: shape. Pure: the graph and places in, places out.

/** Points joined by a stretch of `level` (horizontal, for y) share a line; each line's things are its stretches and points. */
function lineOf(g, real, level) {
  const n = g.slots.length, root = Array.from({ length: n }, (_, v) => v), find = (v) => (root[v] === v ? v : (root[v] = find(root[v])));
  g.stretches.forEach((s, i) => { if (real[i] && (s.h % 2 === 1) === level) root[find(s.a)] = find(s.b); });
  return Array.from({ length: n }, (_, v) => find(v));
}

/** Move one axis: `pos` the places on it, `other` the places across. Answers new places. */
function squeeze(g, real, drawn, pos, other, level) {
  const line = lineOf(g, real, level), things = [];
  // A stretch that keeps a line spans the other axis between its ends; a point spans just its place.
  g.stretches.forEach((s, i) => { if (real[i] && (s.h % 2 === 1) === level) things.push([line[s.a], Math.min(other[s.a], other[s.b]), Math.max(other[s.a], other[s.b])]); });
  drawn.forEach((v) => things.push([line[v], other[v], other[v]]));
  const after = new Map(), add = (p, q) => { if (p !== q) (after.get(p) ?? after.set(p, new Set()).get(p)).add(q); };
  g.stretches.forEach((s, i) => {
    if (!real[i] || (s.h % 2 === 1) === level) return;
    const [p, q] = pos[s.a] < pos[s.b] ? [s.a, s.b] : [s.b, s.a];
    add(line[p], line[q]);
  });
  const placeOf = new Map();
  for (const v of drawn) placeOf.set(line[v], pos[v]);
  things.sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < things.length; i++) {
    for (let j = i + 1; j < things.length && things[j][1] <= things[i][2]; j++) {
      const [a, b] = [things[i][0], things[j][0]];
      if (a === b) continue;
      if (placeOf.get(a) < placeOf.get(b)) add(a, b); else add(b, a);
    }
  }
  // The least place each line can take: one past the furthest of what must come before it.
  const lines = [...placeOf.keys()].sort((a, b) => placeOf.get(a) - placeOf.get(b)), next = new Map();
  for (const l of lines) next.set(l, 0);
  for (const l of lines) for (const q of after.get(l) ?? []) next.set(q, Math.max(next.get(q), next.get(l) + 1));
  return pos.map((p, v) => (next.has(line[v]) ? next.get(line[v]) : p));
}

/** Places for the points that are drawn, the cuts and frame dropped and each axis moved in turn, `rounds` times. */
export function tighten(g, x, y, rounds = 2) {
  const real = g.stretches.map((s) => !s.cut && !s.frame && !s.unseen), drawn = [];
  g.slots.forEach((slots, v) => { if (slots.some((i) => i >= 0 && real[i])) drawn.push(v); });
  for (let r = 0; r < rounds; r++) {
    y = squeeze(g, real, drawn, y, x, true);
    x = squeeze(g, real, drawn, x, y, false);
  }
  return { x, y };
}
