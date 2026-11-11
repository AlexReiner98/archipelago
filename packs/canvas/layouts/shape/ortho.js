// The shape as a graph of points and straight stretches (task e_7vp7udzk): every bend becomes a point, every box a cage
// (GoVisual's, e_58gbzuky) of its four corners and a point on its side where each wire meets it, and every stretch has
// its heading, N, E, S or W, as ./turns.js gives it. Then every corner of it is a quarter or more, as a grid needs. Layer: shape. Pure: the embedding and its angles in, the graph out.

import { QUARTERS } from './sides.js';

/** The graph the grid is read from: `slots[v][h]` is the stretch leaving point v heading h, or -1. */
export function graph() {
  const g = { slots: [], what: [], stretches: [] };
  g.point = (what) => { g.slots.push(new Array(QUARTERS).fill(-1)); g.what.push(what); return g.slots.length - 1; };
  g.join = (a, b, h, meta = {}) => {
    const back = (h + 2) % QUARTERS;
    if (g.slots[a][h] >= 0 || g.slots[b][back] >= 0) throw new Error(`shape: two stretches leave one point one way (${g.what[a].id ?? ''})`);
    g.slots[a][h] = g.slots[b][back] = g.stretches.length;
    g.stretches.push({ a, b, h, ...meta });
    return g.stretches.length - 1;
  };
  return g;
}

/**
 * The graph of points and stretches: a point for each node that is not a box, a cage for each box, a point for each
 * bend. Answers { g, chain, cage }: `chain[k]` the points along edge k from its `from`, `cage` each box's corners.
 */
export function shaped(emb, F, S, H) {
  const g = graph(), at = new Map(), chain = [], cage = new Map();
  const end = (v, k) => at.get(`${v} ${k}`) ?? at.get(`${v}`);
  emb.nodes.forEach((node, v) => {
    if (node.kind !== 'item') { at.set(`${v}`, g.point({ node: v, id: node.id })); return; }
    // The cage: round the box clockwise from its top left, each side's ends in the order the rotation has them.
    const ring = S.ringOf[v], ends = ring.map((k) => ({ k, h: H.out[F.leaving(v, k)] }));
    let start = ends.findIndex((_, i) => S.angle[F.leaving(v, ring[(i - 1 + ring.length) % ring.length]) ^ 1] > 0);
    if (start < 0) start = 0;
    const order = ends.map((_, i) => ends[(start + i) % ends.length]), corners = [];
    const loop = [];
    for (let side = 0; side < QUARTERS; side++) {
      const c = g.point({ node: v, id: node.id, corner: side });
      corners.push(c);
      loop.push({ p: c, side });
      for (const e of order.filter((x) => x.h === side)) {
        const p = g.point({ node: v, id: node.id, side, edge: e.k, jog: H.jogs?.get(`${v} ${e.k}`) });
        at.set(`${v} ${e.k}`, p);
        loop.push({ p, side });
      }
    }
    loop.forEach((x, i) => g.join(x.p, loop[(i + 1) % loop.length].p, (x.side + 1) % QUARTERS, { cage: v }));
    cage.set(v, corners);
  });
  emb.edges.forEach((e, k) => {
    const meta = emb.unseen?.has(e.id) ? { edge: k, unseen: true } : { edge: k }, d = k * 2, a = end(F.tail[d], k), b = end(F.head[d], k), points = [a];
    let h = H.out[d];
    // The step aside in a neck (./necks.js) is told which box it queues beside.
    const n = H.turns[k].length, atTail = (i) => i === 1 && H.jogs?.has(`${F.tail[d]} ${k}`), atHead = (i) => i === n - 1 && H.jogs?.has(`${F.head[d]} ${k}`);
    const as = (i) => (atTail(i) ? { ...meta, neck: F.tail[d], from: H.out[d] } : atHead(i) ? { ...meta, neck: F.head[d], from: H.out[d ^ 1] } : meta);
    for (const [i, t] of H.turns[k].entries()) {
      const p = g.point({ bend: k });
      g.join(points.at(-1), p, h, as(i));
      points.push(p);
      h = (h + t + QUARTERS) % QUARTERS;
    }
    g.join(points.at(-1), b, h, as(n));
    points.push(b);
    chain.push(points);
  });
  return { g, chain, cage, end };
}
