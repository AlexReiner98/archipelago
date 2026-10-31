// Wires through the sides of parts (steady): a wire that turns to get where it goes may instead come straight down
// beside what it calls and go in at its side, or leave its caller's side and go straight across and down, an L of one
// turn. It does where that is fewer turns, runs through no part and along no other wire, and finds the side free.

/** Turn what can be turned of `chains` (each with its points) into L's through the sides of the parts they join. */
export function sideWires({ chains, nodes, x, y, LANE }) {
  const parts = [...nodes.values()].filter((n) => !n.dummy);
  const box = (n) => [x.get(n.id) - n.w / 2, y.get(n.id) - n.h / 2, x.get(n.id) + n.w / 2, y.get(n.id) + n.h / 2];
  const segsOf = (pts) => pts.slice(1).map((p, k) => [pts[k], p]);
  // Through a part: a run that crosses any part but the two it joins.
  const throughPart = (seg, ends) =>
    parts.some((n) => {
      if (ends.includes(n.id)) return false;
      const [l, t, r, b] = box(n), [[x1, y1], [x2, y2]] = seg;
      return Math.max(x1, x2) > l - 2 && Math.min(x1, x2) < r + 2 && Math.max(y1, y2) > t - 2 && Math.min(y1, y2) < b + 2;
    });
  // Along a wire: a run within LANE of another wire's run the same way, where the two overlap.
  const alongWire = (seg, me) =>
    chains.some((o) =>
      o !== me &&
      segsOf(o.points).some(([[a1, b1], [a2, b2]]) => {
        const [[x1, y1], [x2, y2]] = seg;
        const down = Math.abs(x1 - x2) < 0.01, oDown = Math.abs(a1 - a2) < 0.01;
        if (down !== oDown) return false;
        return down
          ? Math.abs(x1 - a1) < LANE && Math.min(Math.max(y1, y2), Math.max(b1, b2)) - Math.max(Math.min(y1, y2), Math.min(b1, b2)) > 0
          : Math.abs(y1 - b1) < LANE && Math.min(Math.max(x1, x2), Math.max(a1, a2)) - Math.max(Math.min(x1, x2), Math.min(a1, a2)) > 0;
      }),
    );
  // Each side of a part takes a wire at its middle, then a quarter above and below it.
  const taken = new Map();
  const sideAt = (n, side) => {
    const used = taken.get(`${n.id}:${side}`) ?? [];
    return [0, -n.h / 4, n.h / 4].map((d) => y.get(n.id) + d).find((sy) => !used.some((u) => Math.abs(u - sy) < LANE));
  };
  const take = (n, side, sy) => taken.set(`${n.id}:${side}`, [...(taken.get(`${n.id}:${side}`) ?? []), sy]);
  const turned = new Set();
  // The wires into the busiest parts first.
  const into = (c) => chains.filter((o) => o.path.at(-1) === c.path.at(-1)).length;
  for (const c of [...chains].sort((p, q) => into(q) - into(p))) {
    if (c.points.length <= 3) continue;
    const A = nodes.get(c.path[0]), B = nodes.get(c.path.at(-1)), ends = [A.id, B.id];
    const [foot, head] = [c.points[0], c.points.at(-1)];
    const tries = [];
    // Down beside what it calls, and in at its side.
    for (const side of [foot[0] < x.get(B.id) ? 'left' : 'right']) {
      const edge = x.get(B.id) + (side === 'left' ? -1 : 1) * (B.w / 2);
      const sy = sideAt(B, side);
      if (sy !== undefined && (side === 'left' ? foot[0] < edge - LANE : foot[0] > edge + LANE) && sy > foot[1] + LANE) tries.push({ pts: [foot, [foot[0], sy], [edge, sy]], n: B, side, sy });
    }
    // Out of its caller's side, across, and down into what it calls.
    for (const side of [head[0] < x.get(A.id) ? 'left' : 'right']) {
      const edge = x.get(A.id) + (side === 'left' ? -1 : 1) * (A.w / 2);
      const sy = sideAt(A, side);
      if (sy !== undefined && (side === 'left' ? head[0] < edge - LANE : head[0] > edge + LANE) && head[1] > sy + LANE) tries.push({ pts: [[edge, sy], [head[0], sy], head], n: A, side, sy });
    }
    const ok = tries.find((t) => segsOf(t.pts).every((s) => !throughPart(s, ends) && !alongWire(s, c)));
    if (!ok) continue;
    c.points = ok.pts;
    take(ok.n, ok.side, ok.sy);
    turned.add(c);
  }
  return turned;
}
