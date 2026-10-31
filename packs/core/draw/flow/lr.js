// Planarity in time that grows with the size of the graph: the left-right test (de Fraysseix and Rosenstiehl, as Brandes
// sets it out), which also answers how the graph lies, as the neighbours round each item. Layer: topology. Pure: edges in,
// an answer out.

/** No item or edge. */
const NONE = -1;

const interval = (low = NONE, high = NONE) => ({ low, high }), empty = (i) => i.low === NONE && i.high === NONE;
const conflictPair = (L = interval(), R = interval()) => ({ L, R });
const swap = (p) => { [p.L, p.R] = [p.R, p.L]; };
/** The top of an empty stack: one and the same, so it compares equal to itself. */
const BOTTOM = conflictPair();

/**
 * The left-right test of `edges`, a list of [x, y]. Answers null when they cannot be drawn with none crossing; with
 * `lie`, a list of the items and each one's neighbours in turn round it; otherwise true.
 */
export function leftRight(edges, lie = false) {
  const index = new Map(), names = [], adj = [], seen = new Set();
  const number = (v) => { let k = index.get(v); if (k === undefined) { index.set(v, (k = names.length)); names.push(v); adj.push([]); } return k; };
  const from = [], to = [];
  for (const [x, y] of edges) {
    const [p, q] = [number(x), number(y)], key = p < q ? p * 4294967296 + q : q * 4294967296 + p;
    if (p === q || seen.has(key)) continue;
    seen.add(key);
    adj[p].push(from.length);
    adj[q].push(from.length);
    from.push(p);
    to.push(q);
  }
  const n = names.length, m = from.length;
  if (n > 2 && m > 3 * (n - 2)) return null;
  const height = new Array(n).fill(NONE), parent = new Array(n).fill(NONE), oriented = new Uint8Array(m), roots = [];
  const lowpt = new Array(m).fill(0), lowpt2 = new Array(m).fill(0), nesting = new Array(m).fill(0), out = Array.from({ length: n }, () => []);
  const orient = (v) => {
    const e = parent[v];
    for (const edge of adj[v]) {
      if (oriented[edge]) continue;
      oriented[edge] = 1;
      const w = from[edge] === v ? to[edge] : from[edge];
      from[edge] = v;
      to[edge] = w;
      out[v].push(edge);
      lowpt[edge] = lowpt2[edge] = height[v];
      if (height[w] === NONE) {
        parent[w] = edge;
        height[w] = height[v] + 1;
        orient(w);
      } else lowpt[edge] = height[w];
      nesting[edge] = 2 * lowpt[edge] + (lowpt2[edge] < height[v] ? 1 : 0);
      if (e === NONE) continue;
      if (lowpt[edge] < lowpt[e]) ((lowpt2[e] = Math.min(lowpt[e], lowpt2[edge])), (lowpt[e] = lowpt[edge]));
      else if (lowpt[edge] > lowpt[e]) lowpt2[e] = Math.min(lowpt2[e], lowpt[edge]);
      else lowpt2[e] = Math.min(lowpt2[e], lowpt2[edge]);
    }
  };
  for (let v = 0; v < n; v++) if (height[v] === NONE) ((height[v] = 0), roots.push(v), orient(v));
  for (const list of out) list.sort((p, q) => nesting[p] - nesting[q]);
  const S = [], bottom = new Array(m).fill(null), lowEdge = new Array(m).fill(NONE), ref = new Array(m).fill(NONE), side = new Array(m).fill(1);
  const top = () => (S.length ? S[S.length - 1] : BOTTOM);
  const conflicting = (i, b) => !empty(i) && lowpt[i.high] > lowpt[b];
  const lowest = (p) => (empty(p.L) ? lowpt[p.R.low] : empty(p.R) ? lowpt[p.L.low] : Math.min(lowpt[p.L.low], lowpt[p.R.low]));
  const constrain = (ei, e) => {
    const P = conflictPair();
    // What returns from e_i goes on one side.
    do {
      const Q = S.pop();
      if (!empty(Q.L)) swap(Q);
      if (!empty(Q.L)) return false;
      if (lowpt[Q.R.low] > lowpt[e]) {
        if (empty(P.R)) P.R = { ...Q.R };
        else ref[P.R.low] = Q.R.high;
        P.R.low = Q.R.low;
      } else ref[Q.R.low] = lowEdge[e];
    } while (top() !== bottom[ei]);
    // What conflicts with it, of the edges before it, goes on the other.
    while (conflicting(top().L, ei) || conflicting(top().R, ei)) {
      const Q = S.pop();
      if (conflicting(Q.R, ei)) swap(Q);
      if (conflicting(Q.R, ei)) return false;
      if (P.R.low !== NONE) ref[P.R.low] = Q.R.high;
      if (Q.R.low !== NONE) P.R.low = Q.R.low;
      if (empty(P.L)) P.L = { ...Q.L };
      else ref[P.L.low] = Q.L.high;
      P.L.low = Q.L.low;
    }
    if (!empty(P.L) || !empty(P.R)) S.push(P);
    return true;
  };
  const trim = (e) => {
    const u = from[e];
    // Back edges that end at the parent go.
    while (S.length && lowest(top()) === height[u]) {
      const P = S.pop();
      if (P.L.low !== NONE) side[P.L.low] = -1;
    }
    if (S.length) {
      const P = S.pop();
      while (P.L.high !== NONE && to[P.L.high] === u) P.L.high = ref[P.L.high];
      if (P.L.high === NONE && P.L.low !== NONE) ((ref[P.L.low] = P.R.low), (side[P.L.low] = -1), (P.L.low = NONE));
      while (P.R.high !== NONE && to[P.R.high] === u) P.R.high = ref[P.R.high];
      if (P.R.high === NONE && P.R.low !== NONE) ((ref[P.R.low] = P.L.low), (side[P.R.low] = -1), (P.R.low = NONE));
      S.push(P);
    }
    // The side of e is the side of its highest return edge.
    if (lowpt[e] < height[u]) {
      const { L: { high: hl }, R: { high: hr } } = top();
      ref[e] = hl !== NONE && (hr === NONE || lowpt[hl] > lowpt[hr]) ? hl : hr;
    }
  };
  const test = (v) => {
    const e = parent[v], list = out[v];
    for (let k = 0; k < list.length; k++) {
      const ei = list[k], w = to[ei];
      bottom[ei] = top();
      if (ei === parent[w]) { if (!test(w)) return false; }
      else ((lowEdge[ei] = ei), S.push(conflictPair(interval(), interval(ei, ei))));
      if (lowpt[ei] < height[v]) {
        if (k === 0) lowEdge[e] = lowEdge[ei];
        else if (!constrain(ei, e)) return false;
      }
    }
    if (e !== NONE) trim(e);
    return true;
  };
  for (const v of roots) if (!test(v)) return null;
  if (!lie) return true;
  // Each edge's side, read down its references; the walk is by hand, as they can run as long as the graph.
  const sign = (e) => {
    const chain = [];
    for (let at = e; at !== NONE; at = ref[at]) chain.push(at);
    for (let k = chain.length - 2; k >= 0; k--) ((side[chain[k]] *= side[chain[k + 1]]), (ref[chain[k]] = NONE));
    return side[e];
  };
  for (let e = 0; e < m; e++) nesting[e] *= sign(e);
  for (const list of out) list.sort((p, q) => nesting[p] - nesting[q]);
  // Round each item, a ring of its neighbours each way, by neighbour.
  const cw = Array.from({ length: n }, () => new Map()), ccw = Array.from({ length: n }, () => new Map()), first = new Array(n).fill(NONE);
  const after = (v, w, at) => {
    if (at === NONE) { cw[v].set(w, w); ccw[v].set(w, w); first[v] = w; return; }
    const next = cw[v].get(at);
    cw[v].set(at, w); cw[v].set(w, next); ccw[v].set(next, w); ccw[v].set(w, at);
  };
  const before = (v, w, at) => {
    if (at === NONE) return after(v, w, NONE);
    after(v, w, ccw[v].get(at));
    if (at === first[v]) first[v] = w;
  };
  for (let v = 0; v < n; v++) {
    let previous = NONE;
    for (const e of out[v]) (after(v, to[e], previous), (previous = to[e]));
  }
  const leftRef = new Array(n).fill(NONE), rightRef = new Array(n).fill(NONE);
  const place = (v) => {
    for (const ei of out[v]) {
      const w = to[ei];
      if (ei === parent[w]) {
        before(w, v, first[w]);
        leftRef[v] = rightRef[v] = w;
        place(w);
      } else if (side[ei] === 1) after(w, v, rightRef[w]);
      else (before(w, v, leftRef[w]), (leftRef[w] = v));
    }
  };
  for (const v of roots) place(v);
  return { names, ccw };
}

/** The faces of a graph that is one biconnected piece, each a cycle of its items, or null when it is not planar. */
export function facesOf(edges) {
  const lie = leftRight(edges, true);
  if (!lie) return null;
  const { names, ccw } = lie, done = ccw.map(() => new Set()), list = [];
  ccw.forEach((round, start) => {
    for (const first of round.keys()) {
      if (done[start].has(first)) continue;
      const face = [];
      for (let [v, w] = [start, first]; !done[v].has(w); ) {
        done[v].add(w);
        face.push(names[v]);
        [v, w] = [w, ccw[w].get(v)];
      }
      list.push(face);
    }
  });
  return list;
}
