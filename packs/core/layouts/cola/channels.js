// Wires that share a stretch, parted into channels (task e_x7kwbu3e): as WebCola's GridRouter.routeEdges does, with its ordering
// of the wires kept but made safe. Two wires that share only a point share no stretch, and are not ordered (WebCola reads
// past the ends of such a pair and fails); where one end of a shared stretch is a path's end, the other end decides,
// and where neither can, the earlier wire goes left. Then each stretch's wires are nudged `gap` apart, across it.

/** For each pair of paths (lists of grid points) that share a stretch, which goes left of the other: a lookup (l, r). */
export function sidesOf(paths, cola) {
  const isLeft = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) <= 0;
  const left = new Map(), put = (l, r) => (left.get(l) ?? left.set(l, new Set()).get(l)).add(r);
  for (let i = 0; i < paths.length - 1; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const e = paths[i], f = paths[j];
      let lcs = new cola.LongestCommonSubsequence(e, f);
      if (lcs.length < 2) continue;
      if (lcs.reversed) {
        // A wire that runs the shared stretch the other way is turned round for this, and back again after (unreverse).
        f.reverse();
        f.reversed = !f.reversed;
        lcs = new cola.LongestCommonSubsequence(e, f);
      }
      const atEnd = lcs.si + lcs.length >= e.length || lcs.ti + lcs.length >= f.length;
      if ((lcs.si <= 0 || lcs.ti <= 0) && atEnd) { put(i, j); continue; }
      const [u, vi, vj] = atEnd ? [e[lcs.si + 1], f[lcs.ti - 1], e[lcs.si - 1]] : [e[lcs.si + lcs.length - 2], e[lcs.si + lcs.length], f[lcs.ti + lcs.length]];
      if (!u || !vi || !vj) put(i, j);
      else if (isLeft(u, vi, vj)) put(j, i);
      else put(i, j);
    }
  }
  return (l, r) => Boolean(left.get(l)?.has(r));
}

/** Each path (a list of points, shared where wires share a way) as segments (pairs of points), wires that share a stretch `gap` apart. */
export function parted(paths, gap, cola) {
  paths = paths.map((p) => [...p]);
  const order = sidesOf(paths, cola);
  const routes = paths.map((p) => cola.GridRouter.makeSegments(p));
  cola.GridRouter.nudgeSegments(routes, 'x', 'y', order, gap);
  cola.GridRouter.nudgeSegments(routes, 'y', 'x', order, gap);
  cola.GridRouter.unreverseEdges(routes, paths);
  return routes;
}
