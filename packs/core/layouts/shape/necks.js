// A busy box kept near its own size (task e_7vp7udzk; the judge's ask, 8 Nov 2026). A wire that leaves a box straight
// pins where it meets the box to where it runs, so a box whose wires run far apart is stretched into a long bar to
// reach them all. Once the grid is read, each box keeps the most of its wires that fit across its own width, and every
// other wire is given a neck: out of the box a step, along beside it, then on its way, two bends that let the box close
// up while the wire queues beside it. Layer: shape. Pure: the turns and the grid in, the turns given their necks.

import { QUARTERS } from './sides.js';

/**
 * Give a neck to each end that stretches its box: `H` the headings (./turns.js), whose `turns` and `bends` are changed
 * and whose `jogs` says which ends have one and which way it runs; `g` the graph, `x` and `y` its places. Answers how
 * many necks were given.
 */
export function necks(emb, H, g, x, y) {
  H.jogs ??= new Map();
  const byBox = new Map();
  g.what.forEach((w, p) => {
    if (w.side === undefined || w.edge === undefined || emb.unseen?.has(emb.edges[w.edge].id)) return;
    (byBox.get(w.node) ?? byBox.set(w.node, []).get(w.node)).push({ p, side: w.side, k: w.edge });
  });
  let added = 0;
  for (const [v, ends] of byBox) {
    for (const axis of [0, 1]) {
      // Axis 0: the ends on the head and foot, placed along x; axis 1: those on the sides, along y.
      const at = axis === 0 ? x : y, across = ends.filter((e) => e.side % 2 === axis);
      const width = Math.max(...[axis, axis + 2].map((s) => across.filter((e) => e.side === s).length), 1) * 2;
      const pinned = across.filter((e) => !H.jogs.has(`${v} ${e.k}`)).sort((a, b) => at[a.p] - at[b.p]);
      let best = [0, 0];
      for (let i = 0, j = 0; j < pinned.length; j++) {
        while (at[pinned[j].p] - at[pinned[i].p] > width) i++;
        if (j - i + 1 > best[1] - best[0]) best = [i, j + 1];
      }
      if (best[1] - best[0] === pinned.length) continue;
      const lo = at[pinned[best[0]].p], hi = at[pinned[best[1] - 1].p];
      for (const e of pinned) {
        if (at[e.p] >= lo && at[e.p] <= hi) continue;
        const ahead = at[e.p] > hi, dir = axis === 0 ? (ahead ? 1 : QUARTERS - 1) : (ahead ? 2 : 0);
        const edge = emb.edges[e.k], t = (e.side + 1) % QUARTERS === dir ? 1 : -1;
        if (edge.from === edge.to) continue;
        H.turns[e.k] = edge.from === emb.nodes[v].id ? [t, -t, ...H.turns[e.k]] : [...H.turns[e.k], t, -t];
        H.jogs.set(`${v} ${e.k}`, dir);
        H.bends += 2;
        added++;
      }
    }
  }
  return added;
}
