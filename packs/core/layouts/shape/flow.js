// A minimum-cost flow (task e_7vp7udzk): what each node gives or takes, arcs with a least and a most and a cost per unit,
// and the cheapest flow that meets every node's need. Successive shortest paths, each found by Dijkstra over reduced
// costs, so a cost must not be below zero. Nothing here knows a drawing. Layer: shape. Pure: numbers in, numbers out.

import { simplex } from './simplex.js';

/**
 * A binary heap of keys and values, the least key first, in typed arrays that grow as it fills: nothing is made per
 * push (bug e_a9w5jeme: the pairs it made were half a second of collecting garbage on 263 items).
 */
function heap(room) {
  let keys = new Float64Array(Math.max(1, room)), vals = new Int32Array(Math.max(1, room)), size = 0;
  const swap = (i, j) => {
    const k = keys[i], v = vals[i];
    ((keys[i] = keys[j]), (vals[i] = vals[j]), (keys[j] = k), (vals[j] = v));
  };
  return {
    get size() { return size; },
    clear() { size = 0; },
    push(k, v) {
      if (size === keys.length) {
        const k2 = new Float64Array(size * 2), v2 = new Int32Array(size * 2);
        (k2.set(keys), v2.set(vals), (keys = k2), (vals = v2));
      }
      ((keys[size] = k), (vals[size] = v));
      for (let i = size++; i > 0; ) {
        const p = (i - 1) >> 1;
        if (keys[p] <= keys[i]) break;
        (swap(p, i), (i = p));
      }
    },
    /** The least key's value; its key is left in `key`. */
    pop() {
      const v = vals[0];
      this.key = keys[0];
      size--;
      if (size) {
        ((keys[0] = keys[size]), (vals[0] = vals[size]));
        for (let i = 0; ; ) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < size && keys[l] < keys[m]) m = l;
          if (r < size && keys[r] < keys[m]) m = r;
          if (m === i) break;
          (swap(m, i), (i = m));
        }
      }
      return v;
    },
    key: 0,
  };
}

/**
 * The cheapest flow over `n` nodes: `supply[v]` is what v gives (below zero, what it takes), and each arc is
 * { from, to, low?, cap?, cost? }; from `batch` arcs up, every shortest path a search finds is sent at once, and with
 * `simplex` (pivots allowed per node and arc) it is solved by the network simplex first. Answers the
 * flow on each arc, in their order, and its cost; throws where no flow meets every need, saying how much was left unmet.
 */
export function minCostFlow(n, supply, arcs, { batch = Infinity, simplex: simplexed = 0 } = {}) {
  const give = supply.slice();
  let total = 0;
  for (const a of arcs) {
    const low = a.low ?? 0;
    if ((a.cost ?? 0) < 0) throw new Error('minCostFlow: a cost below zero');
    if ((a.cap ?? Infinity) < low) throw new Error('minCostFlow: an arc whose most is under its least');
    give[a.from] -= low;
    give[a.to] += low;
  }
  for (const g of give) if (g > 0) total += g;
  if (give.reduce((s, g) => s + g, 0) !== 0) throw new Error('minCostFlow: what is given and taken do not balance');
  // The residual graph: each arc and its reverse side by side, so arc k's reverse is k ^ 1; each node's arcs in the
  // order they were added (`first` and `out`, as one flat list), all in typed arrays.
  const S = n, T = n + 1, size = n + 2, ends = arcs.length + give.filter(Boolean).length, M = ends * 2;
  const to = new Int32Array(M), from = new Int32Array(M), cap = new Float64Array(M), cost = new Float64Array(M);
  let made = 0;
  const add = (u, v, c, w) => {
    ((from[made] = u), (to[made] = v), (cap[made] = c), (cost[made] = w), made++);
    ((from[made] = v), (to[made] = u), (cap[made] = 0), (cost[made] = -w), made++);
  };
  const big = total + 1, slot = new Int32Array(arcs.length);
  arcs.forEach((a, i) => {
    slot[i] = made;
    add(a.from, a.to, Math.min(big, (a.cap ?? Infinity) - (a.low ?? 0)), a.cost ?? 0);
  });
  give.forEach((g, v) => { if (g > 0) add(S, v, g, 0); else if (g < 0) add(v, T, -g, 0); });
  // By the network simplex (./simplex.js), where asked: the same cost, found without a search for every length.
  if (simplexed) {
    const k = arcs.length, f = new Int32Array(k), t = new Int32Array(k), c = new Float64Array(k), w = new Float64Array(k);
    for (let i = 0; i < k; i++) ((f[i] = from[slot[i]]), (t[i] = to[slot[i]]), (c[i] = cap[slot[i]]), (w[i] = cost[slot[i]]));
    const got = simplex(n, give.slice(0, n), f, t, c, w, big, simplexed * (n + k));
    if (got) {
      const flow = arcs.map((a, i) => (a.low ?? 0) + got[i]);
      return { flow, cost: arcs.reduce((s, a, i) => s + flow[i] * (a.cost ?? 0), 0) };
    }
  }
  const first = new Int32Array(size + 1), out = new Int32Array(made);
  for (let k = 0; k < made; k++) first[from[k] + 1]++;
  for (let v = 0; v < size; v++) first[v + 1] += first[v];
  const fill = first.slice(0, size);
  for (let k = 0; k < made; k++) out[fill[from[k]]++] = k;
  const pot = new Float64Array(size), dist = new Float64Array(size), prev = new Int32Array(size), level = new Int32Array(size), next = new Int32Array(size);
  const queue = new Int32Array(size), path = new Int32Array(size), q = heap(made + 1);
  let sent = 0, spent = 0;
  while (sent < total) {
    dist.fill(Infinity);
    prev.fill(-1);
    dist[S] = 0;
    q.clear();
    q.push(0, S);
    while (q.size) {
      const u = q.pop(), d = q.key;
      if (d > dist[u]) continue;
      // Once the sink is reached its distance is known, and every node not yet out of the heap is at least as far: the
      // potentials below rise by no more than the sink's distance, so the rest of the search would change nothing.
      if (u === T) break;
      for (let j = first[u], end = first[u + 1]; j < end; j++) {
        const k = out[j];
        if (cap[k] <= 0) continue;
        const v = to[k], nd = d + cost[k] + pot[u] - pot[v];
        if (nd < dist[v]) { dist[v] = nd; prev[v] = k; q.push(nd, v); }
      }
    }
    if (dist[T] === Infinity) throw new Error(`minCostFlow: no flow meets every need (${total - sent} of ${total} unmet)`);
    // Each potential rises by its distance, but no further than the sink's, so an arc from a node not reached keeps a
    // reduced cost of zero or more.
    for (let v = 0; v < size; v++) pot[v] += Math.min(dist[v], dist[T]);
    // Every shortest path the search found is sent along at once: a blocking flow over the arcs whose reduced cost is now
    // zero, as many as they hold, before the next search (primal-dual). One path a search was the 34,882 searches of bug e_a9w5jeme.
    const tight = (k, u) => cap[k] > 0 && cost[k] + pot[u] - pot[to[k]] === 0, had = sent;
    if (arcs.length >= batch) for (;;) {
      level.fill(-1);
      level[S] = 0;
      queue[0] = S;
      for (let h = 0, t = 1; h < t && level[T] < 0; h++) {
        const u = queue[h];
        for (let j = first[u], end = first[u + 1]; j < end; j++) {
          const k = out[j];
          if (level[to[k]] < 0 && tight(k, u)) ((level[to[k]] = level[u] + 1), (queue[t++] = to[k]));
        }
      }
      if (level[T] < 0) break;
      // Each node's arcs tried from where it last left off: `next` is a place in its stretch of `out`.
      for (let v = 0; v < size; v++) next[v] = first[v];
      for (let pushed = true; pushed && sent < total;) {
        pushed = false;
        // One path down the levels.
        let u = S, steps = 0;
        while (u !== T) {
          const end = first[u + 1];
          while (next[u] < end) {
            const k = out[next[u]];
            if (level[to[k]] === level[u] + 1 && tight(k, u)) break;
            next[u]++;
          }
          if (next[u] === end) {
            if (u === S) break;
            level[u] = -1;
            u = to[path[--steps] ^ 1];
            next[u]++;
            continue;
          }
          const k = out[next[u]];
          path[steps++] = k;
          u = to[k];
        }
        if (u !== T) break;
        let push = total - sent;
        for (let i = 0; i < steps; i++) push = Math.min(push, cap[path[i]]);
        for (let i = 0; i < steps; i++) { const k = path[i]; cap[k] -= push; cap[k ^ 1] += push; spent += push * cost[k]; }
        sent += push;
        pushed = true;
      }
      if (sent >= total) break;
    }
    // Costs that are not whole numbers may leave no arc exactly tight: then the one path the search found is sent.
    if (sent === had) {
      let push = total - sent;
      for (let v = T; v !== S; v = to[prev[v] ^ 1]) push = Math.min(push, cap[prev[v]]);
      for (let v = T; v !== S; v = to[prev[v] ^ 1]) { cap[prev[v]] -= push; cap[prev[v] ^ 1] += push; spent += push * cost[prev[v]]; }
      sent += push;
    }
  }
  const flow = arcs.map((a, i) => (a.low ?? 0) + cap[slot[i] + 1]);
  return { flow, cost: spent + arcs.reduce((s, a) => s + (a.low ?? 0) * (a.cost ?? 0), 0) };
}
