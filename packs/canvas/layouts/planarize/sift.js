// The islands and what lives at sea put in an order on the line by what reads across (task e_m2hdufdq): a wire lies on
// one of the line's two sides, and two that interleave there (one starts between the other's ends and ends past it)
// cross unless they take different sides. So each run of the line (an island, or one step at sea) is moved, in turn,
// whole, to the place where the wires leaving it interleave least with the rest, never past what a firm wire says must
// come before or after it: islands joined by many wires come to stand together, and the one most wires reach stands
// where it crosses fewest. The steps within a run keep their order. Counted and the same each time: the rounds are a
// size on the style. Layer: topology. Pure: runs and wires in, an order out.
//
// Every step and run is a number here, its place in a typed array (task e_yztbb9s3): the counts are whole numbers, so
// asking them of numbers in place of names answers the same, and a move is weighed only where its gain is read (a step
// walked back, or to the best place found, changes no count that is kept).

/** Whether two wires interleave on the line, given their ends' places: one between the other's ends, the other past them. */
const interleave = (p, q, r, s) => {
  if (r === p || r === q || s === p || s === q) return 0;
  const lo = p < q ? p : q, hi = p < q ? q : p;
  return (lo < r && r < hi) !== (lo < s && s < hi) ? 1 : 0;
};

/** Which of `n` things must stand before which: `has(u, v)` whether u must stand before v. */
function mustBefore(n, pairs) {
  if (n * n <= 2 ** 22) {
    const grid = new Uint8Array(n * n);
    for (const [u, v] of pairs) grid[v * n + u] = 1;
    return (u, v) => grid[v * n + u] === 1;
  }
  const set = new Set(pairs.map(([u, v]) => v * n + u));
  return (u, v) => set.has(v * n + u);
}

/** Each run's wires that leave it, packed: for run r, `ends[2i]` its step and `ends[2i + 1]` the far step, i from `from[r]` to `from[r + 1]`. */
function packed(lists) {
  const from = new Int32Array(lists.length + 1);
  lists.forEach((l, r) => (from[r + 1] = from[r] + l.length));
  const ends = new Int32Array(from[lists.length] * 2), most = lists.reduce((m, l) => Math.max(m, l.length), 0);
  lists.forEach((l, r) => l.forEach(([a, b], i) => ((ends[(from[r] + i) * 2] = a), (ends[(from[r] + i) * 2 + 1] = b))));
  // Room for one run's wires' ends, before a move (`near`, `far`) and after it (`near2`, `far2`): gainOf's.
  const room = () => new Int32Array(most);
  return { from, ends, near: room(), far: room(), near2: room(), far2: room() };
}

/**
 * How many fewer pairs of wires interleave once `a` and `b`, side by side, `a` first, change places: a wire of a against
 * one of b, the same wire seen from both its ends not counted, the only pairs the move can change. `pos(v)` is a step's
 * place before the move, `moved(v)` after it. Each pair counted before less after, summed: the same whole number as
 * counting all before and all after.
 */
function gainOf({ from, ends, near, far, near2, far2 }, a, b, pos, moved) {
  const first = from[b], count = from[b + 1] - first;
  if (count === 0 || from[a + 1] === from[a]) return 0;
  // b's wires' ends, before and after, read once.
  for (let j = 0; j < count; j++) {
    const z = ends[(first + j) * 2], w = ends[(first + j) * 2 + 1];
    (near[j] = pos(z)), (far[j] = pos(w)), (near2[j] = moved(z)), (far2[j] = moved(w));
  }
  let n = 0;
  for (let i = from[a]; i < from[a + 1]; i++) {
    const x = ends[i * 2], y = ends[i * 2 + 1], p = pos(x), q = pos(y), p2 = moved(x), q2 = moved(y);
    for (let j = 0; j < count; j++) {
      if (x === ends[(first + j) * 2 + 1] && y === ends[(first + j) * 2]) continue;
      n += interleave(p, q, near[j], far[j]) - interleave(p2, q2, near2[j], far2[j]);
    }
  }
  return n;
}

/**
 * `order` (the runs, in an order the firm wires allow) with each moved to where its wires interleave least. `runOf(u)`
 * is a run's steps in their order; `links` are [a, b] between steps; `firm` are [u, v] between runs, u to stand before
 * v. Sifted for at most `rounds` rounds, or until none moves. Answers the runs in their order.
 */
export function sifted(order, runOf, links, firm, rounds) {
  const names = [...order], runIndex = new Map(names.map((u, r) => [u, r])), count = names.length;
  // Each step a number, its run and its place within it; a step named by two runs is the last's, as a map set twice.
  const stepIndex = new Map(), homeOf = [], withinOf = [], size = new Int32Array(count);
  names.forEach((u, r) => {
    const steps = runOf(u);
    size[r] = steps.length;
    steps.forEach((v, k) => {
      let i = stepIndex.get(v);
      if (i === undefined) stepIndex.set(v, (i = stepIndex.size));
      (homeOf[i] = r), (withinOf[i] = k);
    });
  });
  const home = Int32Array.from(homeOf), within = Int32Array.from(withinOf);
  // Each run's wires that leave it, as [its step, the far step]; a wire within a run never moves against another.
  const out = names.map(() => []);
  for (const [a, b] of links) {
    const i = stepIndex.get(a), j = stepIndex.get(b);
    if (i === undefined || j === undefined || home[i] === home[j]) continue;
    out[home[i]].push([i, j]);
    out[home[j]].push([j, i]);
  }
  const wires = packed(out);
  const before = mustBefore(count, firm.filter(([u, v]) => u !== v && runIndex.has(u) && runIndex.has(v)).map(([u, v]) => [runIndex.get(u), runIndex.get(v)]));
  const line = Int32Array.from(names.keys()), start = new Int32Array(count);
  for (let r = 0, at = 0; r < count; r++) (start[r] = at), (at += size[r]);
  // A step's place, and where it would be were the runs `a` and `b` swapped: a's after b's, b's where a's began.
  let a = 0, b = 0;
  const pos = (v) => start[home[v]] + within[v], moved = (v) => pos(v) + (home[v] === a ? size[b] : home[v] === b ? -size[a] : 0);
  // Swap the runs at k and k + 1; `weigh` says whether to answer how many fewer pairs interleave (else 0).
  const swap = (k, weigh) => {
    (a = line[k]), (b = line[k + 1]);
    const gain = weigh ? gainOf(wires, a, b, pos, moved) : 0;
    (line[k] = b), (line[k + 1] = a);
    (start[b] = start[a]), (start[a] = start[b] + size[b]);
    return gain;
  };
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (let u = 0; u < count; u++) {
      // Walk u up as far as it may go, then down as far, keeping the best place seen; of equals, where it was.
      const from = line.indexOf(u);
      let k = from, gain = 0, best = 0, bestAt = from;
      while (k > 0 && !before(line[k - 1], u)) if (((gain += swap(--k, true)), gain > best)) ((best = gain), (bestAt = k));
      while (k < from) swap(k++, false);
      gain = 0;
      while (k < count - 1 && !before(u, line[k + 1])) if (((gain += swap(k++, true)), gain > best)) ((best = gain), (bestAt = k));
      while (k > bestAt) swap(--k, false);
      while (k < bestAt) swap(k++, false);
      if (bestAt !== from) moved = true;
    }
    if (!moved) break;
  }
  return Array.from(line, (r) => names[r]);
}

/**
 * The steps of `line` each moved, within its own island, to where its wires interleave least with all the others:
 * `islandOf(v)` the island a step may move in (null for what stays: the sea's steps and the borders), `links` [a, b]
 * between steps, `firm` [u, v] where u must stay before v. For at most `rounds` rounds, or until none moves. Answers
 * the line, changed in place.
 */
export function siftedWithin(line, islandOf, links, firm, rounds) {
  const names = [...line], count = names.length, index = new Map(names.map((v, k) => [v, k]));
  // A step named twice on the line is found at its last place, as a map set twice; its first is never moved.
  const steps = Int32Array.from(names, (v) => index.get(v)), at = new Int32Array(count);
  steps.forEach((i, k) => (at[i] = k));
  // Each step's island as a number, the same number for the same island; -1 for what stays.
  const islands = new Map(), island = Int32Array.from(names, (v) => {
    const i = islandOf(v);
    if (i === null) return -1;
    if (!islands.has(i)) islands.set(i, islands.size);
    return islands.get(i);
  });
  const out = names.map(() => []);
  for (const [a, b] of links) {
    const i = index.get(a), j = index.get(b);
    if (a !== b && i !== undefined && j !== undefined) (out[i].push([i, j]), out[j].push([j, i]));
  }
  const wires = packed(out);
  const before = mustBefore(count, firm.filter(([, v]) => index.has(v)).map(([u, v]) => [index.get(u) ?? -1, index.get(v)]).filter(([u]) => u >= 0));
  let a = 0, b = 0;
  const pos = (v) => at[v], moved = (v) => (v === a ? at[b] : v === b ? at[a] : at[v]);
  const swap = (k, weigh) => {
    (a = steps[k]), (b = steps[k + 1]);
    const gain = weigh ? gainOf(wires, a, b, pos, moved) : 0;
    (steps[k] = b), (steps[k + 1] = a);
    (at[b] = k), (at[a] = k + 1);
    return gain;
  };
  const movable = [...steps].filter((v) => island[v] !== -1 && wires.from[v + 1] > wires.from[v]);
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (const v of movable) {
      const home = island[v], from = at[v];
      let k = from, gain = 0, best = 0, bestAt = from;
      while (k > 0 && island[steps[k - 1]] === home && !before(steps[k - 1], v)) if (((gain += swap(--k, true)), gain > best)) ((best = gain), (bestAt = k));
      while (k < from) swap(k++, false);
      gain = 0;
      while (k < count - 1 && island[steps[k + 1]] === home && !before(v, steps[k + 1])) if (((gain += swap(k++, true)), gain > best)) ((best = gain), (bestAt = k));
      while (k > bestAt) swap(--k, false);
      while (k < bestAt) swap(k++, false);
      if (bestAt !== from) moved = true;
    }
    if (!moved) break;
  }
  steps.forEach((i, k) => (line[k] = names[i]));
  return line;
}
