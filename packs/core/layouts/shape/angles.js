// The shape of an embedding at right angles with the fewest bends (task e_7vp7udzk): Tamassia's network, in which each
// node gives its four quarter turns to the faces round it, each face takes what its corners need, and a bend is a
// quarter carried across an edge from one face to the next, at a cost. A box (an item) may send several wires out of one
// side (Kandinsky's zero angle), and the sides its wires ask for (./sides.js) are held by fixing how many quarters lie
// between them, so only the ties and the wires that could not have their side are free. An island's border is kept a
// rectangle: no corner of it turns into the island. A trunk's junction is a T, its branches level across its stem.
// Layer: shape. Pure: the embedding and its faces in, an angle at every corner and the bends on every edge out.

import { minCostFlow } from './flow.js';
import { QUARTERS, sidesOf, wanted } from './sides.js';

/** What a bend in a wire costs; a corner of a border not at one of its nodes; a turn against the rules, which only an
 *  embedding that leaves no other way pays. */
const BEND = 1e1, CORNER = 1, AGAINST = 1e4;

/**
 * The orthogonal shape of `emb`, its faces `F` (./faces.js). Answers { angle, lefts, rights, anchored, bends }: `angle[d]`
 * the quarters at the head of dart d, from its edge clockwise to the next; `lefts[k]` and `rights[k]` the turns on edge
 * k walked from its `from` to its `to`; `anchored` each box's ends that keep the side they asked for, edge to side.
 */
export function orthogonal(emb, F) {
  const { tail, faceOf, faces, outerOf, component, leaving } = F, D = tail.length;
  const ringOf = emb.nodes.map((n) => (emb.rotation[n.id] ?? []).map((id) => F.edgeAt.get(id)));
  const angle = new Int8Array(D).fill(-1), anchored = new Map();
  const supply = faces.map(() => 0), arcs = [], free = []; // free: [dart, arc index]
  const extra = (give) => { supply.push(give); return supply.length - 1; };
  /** The dart that comes into node v along edge k: the angle after k, clockwise, is its. */
  const into = (v, k) => leaving(v, k) ^ 1;

  // The island borders: which face of each border edge is inside, and the angle inside at each border node.
  // Which side is inside is read off what stands there, the island's own or not, whichever way its border is listed.
  const insideOf = new Map(), insideAngle = new Set();
  const own = (face, id) => faces[face].reduce((s, d) => {
    const n = emb.nodes[F.head[d]];
    return n.kind === 'border' || n.kind === 'port' ? s : s + (n.island === id ? 1 : -1);
  }, 0);
  for (const island of emb.islands ?? []) {
    const loop = island.border.map((id) => F.nodeAt.get(id));
    const darts = loop.map((a, i) => {
      const b = loop[(i + 1) % loop.length], k = ringOf[a].find((k) => ringOf[b].includes(k));
      if (k === undefined) throw new Error(`shape: island ${island.id} has no border edge from ${emb.nodes[a].id} to ${emb.nodes[b].id}`);
      return [leaving(a, k), leaving(b, k)];
    });
    const side = darts.reduce((s, [ab, ba]) => s + own(faceOf[ba], island.id) - own(faceOf[ab], island.id), 0) >= 0 ? 1 : 0;
    for (const pair of darts) {
      const inward = pair[side];
      insideOf.set(inward >> 1, faceOf[inward]);
      insideAngle.add(inward);
    }
  }

  emb.nodes.forEach((node, v) => {
    const ring = ringOf[v], deg = ring.length;
    if (!deg) return;
    if (node.kind === 'item') {
      const { start, side, kept } = sidesOf(ring.map((k) => wanted(emb.edges[k], node.id)));
      const held = ring.map((_, i) => i).filter((i) => kept[i]), off = (p) => (p - start + deg) % deg;
      anchored.set(v, new Map(held.map((i) => [ring[i], side[i]])));
      const stretches = held.length
        ? held.map((i, j) => {
          const to = held[(j + 1) % held.length], wraps = off(to) <= off(i);
          return { from: i, n: (to - i + deg) % deg || deg, total: side[to] - side[i] + (wraps ? QUARTERS : 0) };
        })
        : [{ from: 0, n: deg, total: QUARTERS }];
      for (const { from, n, total } of stretches) {
        const darts = Array.from({ length: n }, (_, p) => into(v, ring[(from + p) % deg]));
        if (n === 1) { angle[darts[0]] = total; continue; }
        const at = extra(total);
        for (const d of darts) { free.push([d, arcs.length]); arcs.push({ from: at, to: faceOf[d], cap: total }); }
      }
      return;
    }
    if (deg === 1) { angle[into(v, ring[0])] = QUARTERS; return; }
    if (deg > QUARTERS) throw new Error(`shape: ${node.id} is a point with ${deg} edges, more than four sides`);
    if (deg === QUARTERS) { for (const k of ring) angle[into(v, k)] = 1; return; }
    if (node.kind === 'junction' && deg === QUARTERS - 1) {
      // A junction of a bar (./bars.js) has its stem or branch off the bar; else the stem is the edge whose way through
      // the junction differs from the other two's.
      const outward = ring.map((k) => emb.edges[k].from === node.id);
      const odd = node.bar ? ring.findIndex((k) => !node.bar.includes(emb.edges[k].id)) : outward.findIndex((o) => outward.filter((x) => x === o).length === 1);
      if (odd >= 0) { ring.forEach((k, i) => { angle[into(v, k)] = i !== odd && (i + 1) % deg !== odd ? 2 : 1; }); return; }
    }
    const at = extra(QUARTERS), most = QUARTERS + 1 - deg;
    for (const k of ring) {
      const d = into(v, k), cap = insideAngle.has(d) ? Math.min(2, most) : most;
      free.push([d, arcs.length]);
      arcs.push({ from: at, to: faceOf[d], low: 1, cap });
      if (cap < most) arcs.push({ from: at, to: faceOf[d], cap: most - cap, cost: AGAINST, also: d });
    }
  });

  // What each face needs: twice its corners, less four inside, more four outside; what fixed angles give it is taken off.
  const outer = new Set(outerOf.values());
  faces.forEach((f, i) => { supply[i] -= 2 * f.length + (outer.has(i) ? QUARTERS : -QUARTERS); });
  for (let d = 0; d < D; d++) if (angle[d] >= 0) supply[faceOf[d]] += angle[d];

  // A bend on edge k, convex in face f, carries a quarter from f to the face across.
  const bendArcs = emb.edges.map((e, k) => {
    const f = faceOf[k * 2], g = faceOf[k * 2 + 1];
    if (f === g) return null;
    const inside = insideOf.get(k), bend = emb.unseen?.has(e.id) ? 0 : BEND, cost = (face) => (inside === undefined ? bend : face === inside ? CORNER : AGAINST);
    const at = arcs.length;
    arcs.push({ from: f, to: g, cost: cost(f) }, { from: g, to: f, cost: cost(g) });
    return at;
  });
  if (supply.reduce((s, x) => s + x, 0) !== 0) throw new Error('shape: the embedding is not planar as given (its faces do not add up)');
  const { flow, cost } = minCostFlow(supply.length, supply, arcs);
  for (const [d, a] of free) angle[d] = flow[a];
  arcs.forEach((a, i) => { if (a.also !== undefined) angle[a.also] += flow[i]; });
  const lefts = new Int32Array(emb.edges.length), rights = new Int32Array(emb.edges.length);
  let bends = 0;
  bendArcs.forEach((at, k) => {
    if (at === null) return;
    lefts[k] = flow[at];
    rights[k] = flow[at + 1];
    if (!insideOf.has(k) && !emb.unseen?.has(emb.edges[k].id)) bends += lefts[k] + rights[k];
  });
  return { angle, lefts, rights, anchored, bends, cost, ringOf, component, border: new Set(insideOf.keys()), against: cost >= AGAINST };
}
