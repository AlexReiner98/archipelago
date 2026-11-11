// The least-cost tension of ./turns.js found again from where it nearly is (task e_77u56fwt), by steepest descent
// instead of a whole solve. A cost Σ w · max(0, |c + q·(d[to] - d[from])| - s) over integer d is convex in each
// difference, so it is L-convex (Murota): d is least exactly when no set of nodes raised by one together makes it
// cheaper, and the best such set is a minimum cut. From a point near the least, a turn tried at one node, it takes a
// cut or two where a whole solve takes thousands of pivots. Layer: shape. Pure: numbers in, numbers out.

/**
 * A descent over `n` nodes and fixed terms (`from`, `to`, `w`, `s`, typed arrays, and the unit `q`), made once and run
 * for any `c`: `run(c)` answers the integer d minimising Σ w · max(0, |c + q·(d[to] - d[from])| - s), found from all
 * zero with d[0] held at 0, and what it gained on all zero (`gain`). Each step raises by one the set of nodes that
 * gains most, a least cut found by Dinic's blocking flows over one graph whose holds are set again each step: an arc
 * for each term and one from the source and to the sink at each node.
 */
export function descent(n, from, to, w, s, q = 1) {
  const m = from.length, S = n, T = n + 1, V = n + 2, A = m + 2 * n, M = 2 * A;
  const head = new Int32Array(M), res = new Float64Array(M), first = new Int32Array(V + 1), out = new Int32Array(M);
  const tail = (a) => (a < m ? from[a] : a < m + n ? S : a - m - n);
  const tip = (a) => (a < m ? to[a] : a < m + n ? a - m : T);
  for (let a = 0; a < A; a++) ((head[2 * a] = tip(a)), (head[2 * a + 1] = tail(a)), first[tail(a) + 1]++, first[tip(a) + 1]++);
  for (let v = 0; v < V; v++) first[v + 1] += first[v];
  const fill = first.slice(0, V);
  for (let a = 0; a < A; a++) ((out[fill[tail(a)]++] = 2 * a), (out[fill[tip(a)]++] = 2 * a + 1));
  const level = new Int32Array(V), queue = new Int32Array(V), next = new Int32Array(V), path = new Int32Array(V);
  const u = new Float64Array(n), d = new Int32Array(n);
  const bfs = () => {
    level.fill(-1);
    level[S] = 0;
    queue[0] = S;
    for (let h = 0, e = 1; h < e; h++) {
      const x = queue[h];
      for (let j = first[x], end = first[x + 1]; j < end; j++) {
        const a = out[j];
        if (res[a] > 0 && level[head[a]] < 0) ((level[head[a]] = level[x] + 1), (queue[e++] = head[a]));
      }
    }
    return level[T] >= 0;
  };
  /** The maximum flow source to sink over the holds in `res`; after it, `level` below zero marks the sink's side. */
  const flow = () => {
    while (bfs()) {
      next.set(first.subarray(0, V));
      for (;;) {
        // One path down the levels, each node's arcs tried from where it last left off.
        let x = S, steps = 0;
        while (x !== T) {
          const end = first[x + 1];
          while (next[x] < end) {
            const a = out[next[x]];
            if (res[a] > 0 && level[head[a]] === level[x] + 1) break;
            next[x]++;
          }
          if (next[x] === end) {
            if (x === S) break;
            level[x] = -1;
            x = head[path[--steps] ^ 1];
            next[x]++;
            continue;
          }
          path[steps++] = out[next[x]];
          x = head[out[next[x]]];
        }
        if (x !== T) break;
        let push = Infinity;
        for (let i = 0; i < steps; i++) push = Math.min(push, res[path[i]]);
        for (let i = 0; i < steps; i++) ((res[path[i]] -= push), (res[path[i] ^ 1] += push));
      }
    }
    bfs();
    let sent = 0;
    for (let v = 0; v < n; v++) sent += res[2 * (m + v) + 1];
    return sent;
  };
  // The flow is kept from one cut to the next: only the arcs whose holds changed are put right (`hold`), and the flow
  // of the last run's first cut, all zero, is where the next run starts (`base`), a try differing from the last only
  // at the terms of the nodes it turned.
  const want = new Float64Array(A), excess = new Float64Array(V), prev = new Int32Array(V), base = new Float64Array(M);
  let based = false;
  /** Excess at `v` (or its need, `back`) sent along the residual arcs as far as one path holds: to a terminal, or forward
   *  to a node short of flow, which a flow round a cycle may leave as the only way. */
  const route = (v, back) => {
    prev.fill(-1);
    prev[v] = -2;
    queue[0] = v;
    for (let h = 0, e = 1; h < e; h++) {
      const x = queue[h];
      if (x === S || x === T || (!back && excess[x] < 0)) {
        // Along the path found, from x back to v.
        let amount = Math.abs(excess[v]);
        if (x !== S && x !== T) amount = Math.min(amount, -excess[x]);
        for (let y = x; y !== v; y = head[prev[y] ^ 1]) amount = Math.min(amount, res[back ? prev[y] ^ 1 : prev[y]]);
        for (let y = x; y !== v; y = head[prev[y] ^ 1]) {
          const a = back ? prev[y] ^ 1 : prev[y];
          ((res[a] -= amount), (res[a ^ 1] += amount));
        }
        excess[v] += back ? amount : -amount;
        if (!back && x !== S && x !== T) excess[x] += amount;
        return;
      }
      for (let j = first[x], end = first[x + 1]; j < end; j++) {
        const a = out[j], y = head[a];
        // Forward, x sends along a; back, y sends to x along a's partner.
        if (prev[y] === -1 && res[back ? a ^ 1 : a] > 0) ((prev[y] = a), (queue[e++] = y));
      }
    }
    throw new Error('descent: a flow that cannot be put right');
  };
  /** The holds in `want` given to the arcs, each arc's flow cut to its hold and what that leaves over sent back. */
  const hold = () => {
    for (let a = 0; a < A; a++) {
      const f = res[2 * a + 1], cap = want[a];
      if (res[2 * a] + f === cap) continue;
      const g = Math.min(f, cap);
      ((res[2 * a] = cap - g), (res[2 * a + 1] = g));
      if (g < f) ((excess[head[2 * a + 1]] += f - g), (excess[head[2 * a]] -= f - g));
    }
    excess[S] = excess[T] = 0;
    for (let v = 0; v < n; v++) while (excess[v] > 0) route(v, false);
    for (let v = 0; v < n; v++) while (excess[v] < 0) route(v, true);
  };
  const cost = (k, c, i) => w[i] * Math.max(0, Math.abs(c + q * k) - s[i]);
  return {
    run(c) {
      d.fill(0);
      if (based) res.set(base);
      let gain = 0;
      for (let round = 0; ; round++) {
        // Raising a set X by one, as a cut: each term's cost on its ends' sides is its cost now, a part for each end
        // alone and, for the term's `from` left and `to` raised, what its convexity adds, an arc from one to the other.
        u.fill(0);
        want.fill(0);
        let below = 0;
        for (let i = 0; i < m; i++) {
          if (!w[i] || from[i] === to[i]) continue;
          const k = d[to[i]] - d[from[i]], now = cost(k, c[i], i), down = cost(k - 1, c[i], i);
          u[from[i]] += down - now;
          u[to[i]] += now - down;
          want[i] = cost(k + 1, c[i], i) + down - 2 * now;
        }
        for (let v = 0; v < n; v++) {
          if (u[v] > 0) want[m + v] = u[v];
          else if (u[v] < 0) ((want[m + n + v] = -u[v]), (below += u[v]));
        }
        hold();
        // What the least cut gains: below zero, raise the sink's side. Costs are whole numbers, so a gain is exact.
        const step = below + flow();
        if (!round) ((based = true), base.set(res));
        if (step >= 0) break;
        for (let v = 0; v < n; v++) if (level[v] < 0) d[v]++;
        gain -= step;
      }
      const d0 = d[0];
      for (let v = 0; v < n; v++) d[v] -= d0;
      return { d, gain };
    },
  };
}

/** The same over `terms` { from, to, c, w, s } made into a descent and run once. */
export function descend(n, terms, q = 1) {
  const pick = (f, T) => T.from(terms, (t) => t[f] ?? 0);
  return descent(n, pick('from', Int32Array), pick('to', Int32Array), pick('w', Float64Array), pick('s', Float64Array), q).run(pick('c', Float64Array));
}
