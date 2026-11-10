// The islands and what lives at sea put in an order on the line by what reads across (task e_m2hdufdq): a wire lies on
// one of the line's two sides, and two that interleave there (one starts between the other's ends and ends past it)
// cross unless they take different sides. So each run of the line (an island, or one step at sea) is moved, in turn,
// whole, to the place where the wires leaving it interleave least with the rest, never past what a firm wire says must
// come before or after it: islands joined by many wires come to stand together, and the one most wires reach stands
// where it crosses fewest. The steps within a run keep their order. Counted and the same each time: the rounds are a
// size on the style. Layer: topology. Pure: runs and wires in, an order out.

/**
 * `order` (the runs, in an order the firm wires allow) with each moved to where its wires interleave least. `runOf(u)`
 * is a run's steps in their order; `links` are [a, b] between steps; `firm` are [u, v] between runs, u to stand before
 * v. Sifted for at most `rounds` rounds, or until none moves. Answers the runs in their order.
 */
export function sifted(order, runOf, links, firm, rounds) {
  const line = [...order], home = new Map(), within = new Map(), size = new Map(line.map((u) => [u, runOf(u).length]));
  for (const u of line) runOf(u).forEach((v, k) => (home.set(v, u), within.set(v, k)));
  // Each run's wires that leave it, as [its step, the far step]; a wire within a run never moves against another.
  const out = new Map(line.map((u) => [u, []]));
  for (const [a, b] of links) {
    const [p, q] = [home.get(a), home.get(b)];
    if (p === undefined || q === undefined || p === q) continue;
    out.get(p).push([a, b]);
    out.get(q).push([b, a]);
  }
  const before = new Map(line.map((u) => [u, new Set()]));
  for (const [u, v] of firm) if (u !== v && before.has(v)) before.get(v).add(u);
  const start = new Map();
  let at = 0;
  for (const u of line) (start.set(u, at), (at += size.get(u)));
  const pos = (v) => start.get(home.get(v)) + within.get(v);
  const crosses = (a, b, c, d) => {
    const [p, q, r, s] = [pos(a), pos(b), pos(c), pos(d)], [lo, hi] = p < q ? [p, q] : [q, p];
    if (r === p || r === q || s === p || s === q) return 0;
    return (lo < r && r < hi) !== (lo < s && s < hi) ? 1 : 0;
  };
  // How many pairs of wires interleave, a wire of run a against one of run b: the only pairs swapping them can change.
  const pairs = (a, b) => {
    let n = 0;
    for (const [x, y] of out.get(a)) for (const [z, w] of out.get(b)) if (!(x === w && y === z)) n += crosses(x, y, z, w);
    return n;
  };
  // Swap the runs at k and k + 1, answering how many fewer pairs interleave.
  const swap = (k) => {
    const [a, b] = [line[k], line[k + 1]], was = pairs(a, b);
    [line[k], line[k + 1]] = [b, a];
    start.set(b, start.get(a)).set(a, start.get(b) + size.get(b));
    return was - pairs(a, b);
  };
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (const u of [...order]) {
      // Walk u up as far as it may go, then down as far, keeping the best place seen; of equals, where it was.
      const from = line.indexOf(u);
      let k = from, gain = 0, best = 0, bestAt = from;
      while (k > 0 && !before.get(u).has(line[k - 1])) if (((gain += swap(--k)), gain > best)) ((best = gain), (bestAt = k));
      while (k < from) swap(k++);
      gain = 0;
      while (k < line.length - 1 && !before.get(line[k + 1]).has(u)) if (((gain += swap(k++)), gain > best)) ((best = gain), (bestAt = k));
      while (k > bestAt) swap(--k);
      while (k < bestAt) swap(k++);
      if (bestAt !== from) moved = true;
    }
    if (!moved) break;
  }
  return line;
}

/**
 * The steps of `line` each moved, within its own island, to where its wires interleave least with all the others:
 * `islandOf(v)` the island a step may move in (null for what stays: the sea's steps and the borders), `links` [a, b]
 * between steps, `firm` [u, v] where u must stay before v. For at most `rounds` rounds, or until none moves. Answers
 * the line, changed in place.
 */
export function siftedWithin(line, islandOf, links, firm, rounds) {
  const at = new Map(line.map((v, k) => [v, k])), out = new Map(line.map((v) => [v, []])), before = new Map(line.map((v) => [v, new Set()]));
  for (const [a, b] of links) if (a !== b && out.has(a) && out.has(b)) (out.get(a).push([a, b]), out.get(b).push([b, a]));
  for (const [u, v] of firm) if (before.has(v)) before.get(v).add(u);
  const crosses = (a, b, c, d) => {
    const [p, q, r, s] = [at.get(a), at.get(b), at.get(c), at.get(d)], [lo, hi] = p < q ? [p, q] : [q, p];
    if (r === p || r === q || s === p || s === q) return 0;
    return (lo < r && r < hi) !== (lo < s && s < hi) ? 1 : 0;
  };
  const pairs = (a, b) => {
    let n = 0;
    for (const [x, y] of out.get(a)) for (const [z, w] of out.get(b)) if (!(x === w && y === z)) n += crosses(x, y, z, w);
    return n;
  };
  const swap = (k) => {
    const [a, b] = [line[k], line[k + 1]], was = pairs(a, b);
    [line[k], line[k + 1]] = [b, a];
    at.set(b, k).set(a, k + 1);
    return was - pairs(a, b);
  };
  const movable = line.filter((v) => islandOf(v) !== null && out.get(v).length);
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (const v of movable) {
      const home = islandOf(v), from = at.get(v);
      let k = from, gain = 0, best = 0, bestAt = from;
      while (k > 0 && islandOf(line[k - 1]) === home && !before.get(v).has(line[k - 1])) if (((gain += swap(--k)), gain > best)) ((best = gain), (bestAt = k));
      while (k < from) swap(k++);
      gain = 0;
      while (k < line.length - 1 && islandOf(line[k + 1]) === home && !before.get(line[k + 1]).has(v)) if (((gain += swap(k++)), gain > best)) ((best = gain), (bestAt = k));
      while (k > bestAt) swap(--k);
      while (k < bestAt) swap(k++);
      if (bestAt !== from) moved = true;
    }
    if (!moved) break;
  }
  return line;
}

