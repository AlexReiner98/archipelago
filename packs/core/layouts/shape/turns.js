// Which way every end of every edge leaves its node, and how each edge turns between (task e_7vp7udzk), in one solve.
// Tamassia's network (./angles.js) gives the angles and bends of a shape only up to turning it round, and a box's head
// must stand at the top whichever box it is. Every closed shape with those angles is the network's own with some nodes
// turned round: turning node v by r adds r to the turns of every edge into v and takes r from every edge out of it, and
// the faces still close. So the one solve is: each box turned to face the sides its wires asked for, every other node
// turned however makes the fewest turns in all, no wire doubling back, borders kept as the network had them. Each cost
// is w · max(0, |c + λ(to) - λ(from)| - s) over the integer turns λ: a minimum-cost tension, solved exactly as the dual
// of a minimum-cost flow (./flow.js). Boxes may only turn by whole turns of four, which a flow cannot say, so two such
// solves take turns until neither gains: the other nodes with the boxes held, then whole turns of four everywhere.
// Layer: shape. Pure: the shape in, headings and turns out.

import { minCostFlow } from './flow.js';
import { QUARTERS } from './sides.js';

/** What a turn on a wire costs; a bend in a trunk's bar, drawn straight where it can be; a wire doubling back, each turn one way past the first along any run of it; and a
 *  turn on a border off the network's own, which must keep its rectangle. */
const BEND = 1, BACK = 2 + 1, BAR = 1e1, BORDER = 1e3;

/** Turns as a list, -1 left and 1 right: `n` of them, all one way. */
const run = (n) => Array.from({ length: Math.abs(n) }, () => Math.sign(n));
const mod = (a) => ((a % QUARTERS) + QUARTERS) % QUARTERS;

/**
 * The integer λ at each of `n` nodes that minimises Σ w · max(0, |c + λ[to] - λ[from]| - s) over `terms`
 * { from, to, c, w, s }, node 0 held at 0. Solved as its dual, a circulation φ, |φ| ≤ w, each unit costing s less c
 * one way and s more c the other; λ are the shortest paths it leaves.
 */
export function tension(n, terms) {
  const supply = new Array(n).fill(0), arcs = [];
  const arc = (from, to, cap, cost) => {
    // An arc that pays to run is run full from the start, and what is left of it runs back.
    if (cost < 0) { supply[from] -= cap; supply[to] += cap; arcs.push({ from: to, to: from, cap, cost: -cost }); } else arcs.push({ from, to, cap, cost });
  };
  for (const { from, to, c, w, s = 0 } of terms) {
    if (!w || from === to) continue;
    arc(from, to, w, s - c);
    arc(to, from, w, s + c);
  }
  const { flow } = minCostFlow(n, supply, arcs);
  const left = [];
  arcs.forEach((a, i) => {
    if (flow[i] < a.cap) left.push([a.from, a.to, a.cost]);
    if (flow[i] > 0) left.push([a.to, a.from, -a.cost]);
  });
  const dist = new Array(n).fill(0);
  for (let round = 0, changed = true; changed && round <= n; round++) {
    changed = false;
    for (const [a, b, cost] of left) if (dist[a] + cost < dist[b]) { dist[b] = dist[a] + cost; changed = true; }
  }
  return dist.map((d) => d - dist[0]);
}

/** w · max(0, |x + 4d| - s) over whole d, as terms a |d - b| (each twice its weight, the same for every cost). */
function wholeTurns(x, w, s) {
  const f = (d) => w * Math.max(0, Math.abs(x + QUARTERS * d) - s), out = [];
  const lo = Math.floor((-s - x) / QUARTERS), hi = Math.ceil((s - x) / QUARTERS);
  for (let b = lo; b <= hi; b++) {
    const a = f(b + 1) - 2 * f(b) + f(b - 1);
    if (a) out.push({ c: -b, w: a });
  }
  return out;
}

/** The network's own frame: every dart's heading with each part turned from one node of it, each edge as bent. */
function frame(F, S, nA) {
  const { tail, head, leaving } = F, D = tail.length, h0 = new Int8Array(D).fill(-1);
  const orient = (v, k, h) => {
    const ring = S.ringOf[v], i = ring.indexOf(k);
    for (let j = 0; j < ring.length; j++) {
      const d = leaving(v, ring[(i + j) % ring.length]);
      h0[d] = h;
      h = (h + S.angle[d ^ 1]) % QUARTERS;
    }
  };
  for (let start = 0; start < D; start++) {
    if (h0[start] >= 0) continue;
    orient(tail[start], start >> 1, 0);
    const queue = [tail[start]];
    for (let q = 0; q < queue.length; q++) {
      for (const k of S.ringOf[queue[q]]) {
        const d = leaving(queue[q], k);
        if (h0[d ^ 1] >= 0) continue;
        orient(head[d], k, mod(h0[d] + (d % 2 === 0 ? nA[k] : -nA[k]) + 2));
        queue.push(head[d]);
      }
    }
  }
  return h0;
}

/** Every cost: each edge's turns, and along every wire each run of edges and the nodes between turning once at most. */
function costs(emb, F, S, nA, h0) {
  const vOf = (id) => F.nodeAt.get(id);
  const terms = emb.edges.map((e, k) => ({ from: vOf(e.from), to: vOf(e.to), base: S.border.has(k) ? 0 : nA[k], w: S.border.has(k) ? BORDER : emb.unseen?.has(e.id) ? 0 : e.bar ? BAR : BEND, s: 0 }));
  for (const w of emb.wires ?? []) {
    if (w.type === 'unseen' || w.type === 'border') continue;
    const ks = w.edges.map((id) => F.edgeAt.get(id)), first = emb.edges[ks[0]];
    const next = ks.length > 1 ? [emb.edges[ks[1]].from, emb.edges[ks[1]].to] : [];
    let here = vOf(next.includes(first.from) ? first.to : first.from);
    // Each edge's turns the way the wire runs, and the turn it makes at each node it passes (a branch off a bar).
    const path = [here], along = [], atNode = [0];
    ks.forEach((k, i) => {
      const forward = vOf(emb.edges[k].from) === here;
      if (i > 0) {
        const t = mod(h0[F.leaving(here, k)] - h0[F.leaving(here, ks[i - 1])] - 2);
        atNode.push(t === QUARTERS - 1 ? -1 : t);
      }
      along.push(forward ? nA[k] : -nA[k]);
      path.push(here = vOf(forward ? emb.edges[k].to : emb.edges[k].from));
    });
    for (let i = 0; i < ks.length; i++) {
      for (let j = i, c = 0; j < ks.length; j++) {
        c += along[j] + (j > i ? atNode[j] : 0);
        terms.push({ from: path[i], to: path[j + 1], base: c, w: BACK, s: 1, nodes: path.slice(i, j + 2) });
      }
    }
  }
  return terms;
}

/**
 * The heading every dart leaves its tail with (`out`, N E S W as 0 to 3), the turns along every edge from its `from`
 * (`turns`), how many there are on wires (`bends`), and how many border edges turn otherwise than the network had them
 * (`bent`), which leaves an island no rectangle.
 */
export function headings(emb, F, S) {
  const { tail, leaving } = F, D = tail.length, N = emb.nodes.length;
  const nA = emb.edges.map((_, k) => S.rights[k] - S.lefts[k]), h0 = frame(F, S, nA);
  // Each box with sides asked is held turned so they face as asked.
  const held = new Map();
  for (const [v, sides] of S.anchored) {
    const [k, side] = sides.entries().next().value ?? [];
    if (k !== undefined) held.set(v, mod(side - h0[leaving(v, k)]));
  }
  const vOf = (id) => F.nodeAt.get(id), terms = costs(emb, F, S, nA, h0), turn = emb.nodes.map((_, v) => held.get(v) ?? 0);
  const val = (e) => e.base + turn[e.to] - turn[e.from];
  const price = () => terms.reduce((sum, e) => sum + e.w * Math.max(0, Math.abs(val(e)) - e.s), 0);
  const index = new Map();
  emb.nodes.forEach((_, v) => { if (!held.has(v)) index.set(v, index.size + 1); });
  const at = (v) => index.get(v) ?? 0;
  /** Whole turns of four at every node, boxes too, every node's turn kept up to four. */
  const lift = () => {
    const whole = tension(N, terms.flatMap((e) => wholeTurns(val(e), e.w, e.s).map((t) => ({ from: e.from, to: e.to, ...t }))));
    turn.forEach((t, v) => { turn[v] = t + QUARTERS * whole[v]; });
  };
  /** The two solves in turn until neither gains: every other node's turn with the boxes held, then whole turns. */
  const settle = () => {
    for (let last = Infinity, now = price(); now < last; last = now, now = price()) {
      const more = tension(index.size + 1, terms.map((e) => ({ from: at(e.from), to: at(e.to), c: val(e), w: e.w, s: e.s })));
      index.forEach((i, v) => { turn[v] += more[i]; });
      lift();
    }
  };
  settle();
  // A trunk's bar turns as one: its nodes are tried together.
  const barOf = emb.nodes.map((_, v) => [v]);
  emb.edges.forEach((e) => {
    if (!e.bar) return;
    const [a, b] = [barOf[vOf(e.from)], barOf[vOf(e.to)]];
    if (a === b) return;
    a.push(...b);
    for (const u of b) barOf[u] = a;
  });
  // Where a wire still doubles back, each node along it (with its bar) is tried turned each other way with the whole
  // turns found again, for a gain neither solve finds alone (a junction turned and a box lifted with it).
  for (let gained = true; gained;) {
    gained = false;
    const doubled = terms.filter((e) => e.w && Math.abs(val(e)) > e.s + 1);
    for (const v of new Set(doubled.flatMap((e) => e.nodes ?? [e.from, e.to]).filter((u) => !held.has(u)))) {
      const before = turn.slice(), was = price();
      let better = false;
      for (let t = 1; t < QUARTERS && !better; t++) {
        turn.splice(0, N, ...before);
        for (const u of barOf[v]) turn[u] += t;
        lift();
        better = price() < was;
      }
      if (better) { settle(); gained = true; } else turn.splice(0, N, ...before);
    }
  }
  const out = new Int8Array(D);
  for (let d = 0; d < D; d++) out[d] = mod(h0[d] + turn[tail[d]]);
  const turns = [];
  let bends = 0, bent = 0;
  emb.edges.forEach((e, k) => {
    const n = nA[k] + turn[F.nodeAt.get(e.to)] - turn[F.nodeAt.get(e.from)];
    turns.push(run(n));
    if (S.border.has(k)) { if (n !== nA[k]) bent++; } else if (!emb.unseen?.has(e.id)) bends += Math.abs(n);
  });
  return { out, turns, bends, bent };
}
