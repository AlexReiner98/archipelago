// The knot of a graph: its items of three or more wires, and the chains of two-wire items between them. Springs place it
// when it is too big for the planar calculation, a local search moves what still crosses, each edge weighed by the wires
// it carries. Pure: names in, places out.

import { crosses } from './planar.js';

/** Of a connected core: its knots (items of other than two wires) and the chains between them, each { u, v, inner }. */
export function chainsOf(list, a) {
  const own = new Set(list), wires = (id) => [...a.get(id)].filter((w) => own.has(w));
  const knots = list.filter((id) => wires(id).length !== 2);
  if (!knots.length) knots.push(list[0]);
  const isKnot = new Set(knots), done = new Set(), chains = [];
  for (const u of knots) for (const first of wires(u)) {
    if (isKnot.has(first)) {
      const key = u < first ? `${u} ${first}` : `${first} ${u}`;
      if (!done.has(key)) (done.add(key), chains.push({ u, v: first, inner: [] }));
      continue;
    }
    if (done.has(first)) continue;
    const inner = [first];
    let prev = u, at = first;
    done.add(first);
    for (;;) {
      const on = wires(at).find((w) => w !== prev) ?? prev;
      if (isKnot.has(on)) { chains.push({ u, v: on, inner }); break; }
      if (done.has(on)) break;
      inner.push(on);
      done.add(on);
      [prev, at] = [at, on];
    }
  }
  return { knots, isKnot, chains };
}

/** Stress by stochastic descent (Zheng, Pawar, Goodman): each pair of `only` pulled to its distance along the graph. */
export function stress(core, a, reach, at, unit, only) {
  const index = new Map(core.map((id, k) => [id, k])), n = core.length;
  const next = core.map((id) => [...a.get(id)].filter((w) => index.has(w)).map((w) => index.get(w)));
  const wanted = core.map((_, k) => k).filter((k) => only.has(core[k]));
  const pairs = [], hops = new Int32Array(n), queue = new Int32Array(n);
  for (const s of wanted) {
    hops.fill(-1);
    hops[s] = 0;
    queue[0] = s;
    for (let h = 0, t = 1; h < t; h++) for (const w of next[queue[h]]) if (hops[w] < 0) ((hops[w] = hops[queue[h]] + 1), (queue[t++] = w));
    for (const j of wanted) if (j > s && hops[j] > 0) pairs.push(s, j, hops[j] * unit + reach(core[s]) + reach(core[j]));
  }
  const px = new Float64Array(n), py = new Float64Array(n);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let k = 0; k < n; k++) ((px[k] = rnd() * 1000), (py[k] = rnd() * 1000));
  const m = pairs.length / 3, ROUNDS = 30, order = Int32Array.from({ length: m }, (_, k) => k);
  let dmax = 1, dmin = Infinity;
  for (let k = 0; k < m; k++) ((dmax = Math.max(dmax, pairs[3 * k + 2])), (dmin = Math.min(dmin, pairs[3 * k + 2])));
  for (let t = 0; t < ROUNDS; t++) {
    const eta = dmax * dmax * Math.exp((t / (ROUNDS - 1)) * Math.log((0.1 * dmin * dmin) / (dmax * dmax)));
    for (let k = m - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)), v = order[k]; order[k] = order[j]; order[j] = v; }
    for (let q = 0; q < m; q++) {
      const k = order[q], i = pairs[3 * k], j = pairs[3 * k + 1], d = pairs[3 * k + 2], dx = px[i] - px[j], dy = py[i] - py[j], l = Math.hypot(dx, dy) || 1;
      const step = (Math.min(1, eta / (d * d)) * (l - d)) / (2 * l);
      px[i] -= dx * step; py[i] -= dy * step; px[j] += dx * step; py[j] += dy * step;
    }
  }
  core.forEach((id, k) => only.has(id) && at.set(id, [px[k], py[k]]));
}

/** Move each item on a crossing to where its wires, by what they carry, cross least, within `budget` checks. */
export function untangle(knots, near, edges, weight, at, reach, unit, budget) {
  const hits = (id, to) => {
    let c = 0;
    for (const w of near.get(id)) {
      const q = at.get(w), wt = weight(id, w);
      for (const [u, v, carried] of edges) if (u !== id && v !== id && u !== w && v !== w && crosses(to, q, at.get(u), at.get(v))) c += wt * carried;
    }
    return c;
  };
  const length = (id, to) => [...near.get(id)].reduce((s, w) => s + Math.hypot(to[0] - at.get(w)[0], to[1] - at.get(w)[1]), 0);
  const clear = (id, to) => knots.every((o) => o === id || Math.hypot(to[0] - at.get(o)[0], to[1] - at.get(o)[1]) > (reach(id) + reach(o)) * 0.6);
  let work = 0;
  for (let pass = 0; pass < 8 && work < budget; pass++) {
    let moved = 0;
    for (const id of knots) {
      const now = at.get(id), around = [...near.get(id)].map((w) => at.get(w));
      if (!around.length || work > budget) continue;
      work += edges.length * around.length;
      const c = hits(id, now);
      if (!c) continue;
      const mid = [around.reduce((s, p) => s + p[0], 0) / around.length, around.reduce((s, p) => s + p[1], 0) / around.length];
      const R = reach(id) * 2 + unit, tries = [mid];
      for (let r = 1; r <= 3; r++) for (let k = 0; k < 12; k++) tries.push([mid[0] + r * R * Math.cos((k * Math.PI) / 6), mid[1] + r * R * Math.sin((k * Math.PI) / 6)]);
      for (const p of around) for (let k = 0; k < 8; k++) tries.push([p[0] + R * Math.cos((k * Math.PI) / 4), p[1] + R * Math.sin((k * Math.PI) / 4)]);
      let best = now, least = c * 1e6 + length(id, now);
      for (const t of tries) {
        if (!clear(id, t)) continue;
        work += edges.length * around.length;
        const s = hits(id, t) * 1e6 + length(id, t);
        if (s < least) [least, best] = [s, t];
      }
      if (best !== now) (at.set(id, best), moved++);
    }
    if (!moved) break;
  }
}
