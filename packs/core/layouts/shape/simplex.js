// A minimum-cost flow by the network simplex (bug e_a9w5jeme), the same question ./flow.js answers by shortest paths:
// a spanning tree of arcs that carry what they carry, every other arc empty or full, and an arc that would make it
// cheaper taken into the tree in turn until none would. Fast where costs spread wide, which makes shortest paths search
// once for every length. Each node is given a potential so a tree arc costs nothing reduced; the tree starts as one
// artificial arc from each node to a root, too dear ever to stay in use, and is kept strongly feasible (the leaving arc
// the last that blocks), so it never cycles. Layer: shape. Pure: numbers in, numbers out.

const LOWER = 1, TREE = 0, UPPER = -1;

/**
 * The cheapest flow over `n` nodes given `give` (what each gives, after least amounts) and arcs as typed arrays
 * (`from`, `to`, `cap` with no limit as `big`, `cost`, any sign): the flow on each arc, or null where no flow meets every
 * need. `pivots` caps the work: past it, null too.
 */
export function simplex(n, give, from, to, cap, cost, big, pivots) {
  const m = from.length, R = n, N = n + 1, E = m + n;
  const src = new Int32Array(E), dst = new Int32Array(E), hi = new Float64Array(E), c = new Float64Array(E), flow = new Float64Array(E), state = new Int8Array(E);
  let most = 0;
  for (let e = 0; e < m; e++) ((src[e] = from[e]), (dst[e] = to[e]), (hi[e] = cap[e]), (c[e] = cost[e]), (state[e] = LOWER), (most = Math.max(most, Math.abs(cost[e]))));
  // The artificial arcs, each node's to the root, dear enough that any flow on real arcs beats one.
  const ART = (N + 1) * (most + 1);
  const parent = new Int32Array(N), pred = new Int32Array(N), up = new Int8Array(N), depth = new Int32Array(N), pi = new Float64Array(N);
  const kids = Array.from({ length: N }, () => []);
  parent[R] = -1;
  for (let v = 0; v < n; v++) {
    const e = m + v, g = give[v];
    if (g >= 0) ((src[e] = v), (dst[e] = R), (flow[e] = g), (up[v] = 1), (pi[v] = -ART));
    else ((src[e] = R), (dst[e] = v), (flow[e] = -g), (up[v] = 0), (pi[v] = ART));
    ((hi[e] = big), (c[e] = ART), (state[e] = TREE), (parent[v] = R), (pred[v] = e), (depth[v] = 1), kids[R].push(v));
  }
  const reduced = (e) => c[e] + pi[src[e]] - pi[dst[e]];
  const block = Math.max(1, Math.ceil(Math.sqrt(m))), unlink = (p, v) => { const k = kids[p], i = k.indexOf(v); k[i] = k[k.length - 1]; k.pop(); };
  let next = 0;
  /** The arc that most wants in, looked for a block at a time from where the last search stopped; -1 when none does. */
  const entering = () => {
    let best = -1, worst = 0, seen = 0;
    for (let k = 0; k < m; k++) {
      const e = next;
      next = next + 1 === m ? 0 : next + 1;
      const v = state[e] * reduced(e);
      if (v < worst) ((worst = v), (best = e));
      if (++seen === block) {
        if (best >= 0) return best;
        seen = 0;
      }
    }
    return best;
  };
  for (let pivot = 0; ; pivot++) {
    if (pivot > pivots) return null;
    const ein = m ? entering() : -1;
    if (ein < 0) break;
    const first = state[ein] === LOWER ? src[ein] : dst[ein], second = state[ein] === LOWER ? dst[ein] : src[ein];
    // Where the two sides of the cycle meet.
    let a = first, b = second;
    while (a !== b) {
      if (depth[a] > depth[b]) a = parent[a];
      else if (depth[b] > depth[a]) b = parent[b];
      else ((a = parent[a]), (b = parent[b]));
    }
    const join = a;
    // How much can go round: down the first side, across, up the second; the last arc that blocks leaves.
    let delta = hi[ein], out = -1, side = 0;
    for (let u = first; u !== join; u = parent[u]) {
      const e = pred[u], d = up[u] ? flow[e] : hi[e] >= big ? Infinity : hi[e] - flow[e];
      if (d < delta) ((delta = d), (out = u), (side = 1));
    }
    for (let u = second; u !== join; u = parent[u]) {
      const e = pred[u], d = up[u] ? (hi[e] >= big ? Infinity : hi[e] - flow[e]) : flow[e];
      if (d <= delta) ((delta = d), (out = u), (side = 2));
    }
    if (delta === Infinity) return null;
    if (delta > 0) {
      const val = state[ein] * delta;
      flow[ein] += val;
      for (let u = src[ein]; u !== join; u = parent[u]) flow[pred[u]] -= (up[u] ? 1 : -1) * val;
      for (let u = dst[ein]; u !== join; u = parent[u]) flow[pred[u]] += (up[u] ? 1 : -1) * val;
    }
    if (!side) { state[ein] = -state[ein]; continue; }
    const eout = pred[out];
    state[ein] = TREE;
    state[eout] = flow[eout] === 0 ? LOWER : UPPER;
    // The subtree under `out` hangs again from the entering arc: the path from its end in it up to `out` turns round.
    const uIn = side === 1 ? first : second, vIn = side === 1 ? second : first;
    let w = uIn, newParent = vIn, newPred = ein, newUp = src[ein] === uIn ? 1 : 0;
    for (;;) {
      const oldParent = parent[w], oldPred = pred[w], oldUp = up[w], stop = w === out;
      unlink(oldParent, w);
      ((parent[w] = newParent), (pred[w] = newPred), (up[w] = newUp), kids[newParent].push(w));
      if (stop) break;
      ((newParent = w), (newPred = oldPred), (newUp = oldUp ? 0 : 1), (w = oldParent));
    }
    // Depths and potentials of what was hung again, from its new top down.
    const stack = [uIn];
    while (stack.length) {
      const v = stack.pop(), e = pred[v], p = parent[v];
      depth[v] = depth[p] + 1;
      pi[v] = up[v] ? pi[p] - c[e] : pi[p] + c[e];
      for (const k of kids[v]) stack.push(k);
    }
  }
  for (let v = 0; v < n; v++) if (flow[m + v] > 0) return null;
  return flow.subarray(0, m);
}
