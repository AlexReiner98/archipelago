// A minimum-cost flow (task e_7vp7udzk): what each node gives or takes, arcs with a least and a most and a cost per unit,
// and the cheapest flow that meets every node's need. Successive shortest paths, each found by Dijkstra over reduced
// costs, so a cost must not be below zero. Nothing here knows a drawing. Layer: shape. Pure: numbers in, numbers out.

/** A binary heap of [key, value], the least key first. */
function heap() {
  const a = [];
  const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } };
  const down = (i) => {
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < a.length && a[l][0] < a[m][0]) m = l;
      if (r < a.length && a[r][0] < a[m][0]) m = r;
      if (m === i) return;
      [a[m], a[i]] = [a[i], a[m]];
      i = m;
    }
  };
  return {
    get size() { return a.length; },
    push(k, v) { a.push([k, v]); up(a.length - 1); },
    pop() { const top = a[0], last = a.pop(); if (a.length) { a[0] = last; down(0); } return top; },
  };
}

/**
 * The cheapest flow over `n` nodes: `supply[v]` is what v gives (below zero, what it takes), and each arc is
 * { from, to, low?, cap?, cost? }. Answers the flow on each arc, in their order, and its cost; throws where no flow
 * meets every need, saying how much was left unmet.
 */
export function minCostFlow(n, supply, arcs) {
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
  // The residual graph: each arc and its reverse side by side, so arc k's reverse is k ^ 1.
  const S = n, T = n + 1, size = n + 2, to = [], cap = [], cost = [], head = Array.from({ length: size }, () => []);
  const add = (u, v, c, w) => {
    head[u].push(to.length); to.push(v); cap.push(c); cost.push(w);
    head[v].push(to.length); to.push(u); cap.push(0); cost.push(-w);
  };
  const big = total + 1, slot = [];
  for (const a of arcs) {
    slot.push(to.length);
    add(a.from, a.to, Math.min(big, (a.cap ?? Infinity) - (a.low ?? 0)), a.cost ?? 0);
  }
  give.forEach((g, v) => { if (g > 0) add(S, v, g, 0); else if (g < 0) add(v, T, -g, 0); });
  const pot = new Array(size).fill(0), dist = new Array(size), prev = new Array(size);
  let sent = 0, spent = 0;
  while (sent < total) {
    dist.fill(Infinity);
    prev.fill(-1);
    dist[S] = 0;
    const q = heap();
    q.push(0, S);
    while (q.size) {
      const [d, u] = q.pop();
      if (d > dist[u]) continue;
      for (const k of head[u]) {
        if (cap[k] <= 0) continue;
        const v = to[k], nd = d + cost[k] + pot[u] - pot[v];
        if (nd < dist[v]) { dist[v] = nd; prev[v] = k; q.push(nd, v); }
      }
    }
    if (dist[T] === Infinity) throw new Error(`minCostFlow: no flow meets every need (${total - sent} of ${total} unmet)`);
    // Each potential rises by its distance, but no further than the sink's, so an arc from a node not reached keeps a
    // reduced cost of zero or more.
    for (let v = 0; v < size; v++) pot[v] += Math.min(dist[v], dist[T]);
    let push = total - sent;
    for (let v = T; v !== S; v = to[prev[v] ^ 1]) push = Math.min(push, cap[prev[v]]);
    for (let v = T; v !== S; v = to[prev[v] ^ 1]) { cap[prev[v]] -= push; cap[prev[v] ^ 1] += push; spent += push * cost[prev[v]]; }
    sent += push;
  }
  const flow = arcs.map((a, i) => (a.low ?? 0) + cap[slot[i] + 1]);
  return { flow, cost: spent + arcs.reduce((s, a) => s + (a.low ?? 0) * (a.cost ?? 0), 0) };
}
