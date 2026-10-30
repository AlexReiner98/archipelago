// A graph made planar, ready to draw: links threaded through the faces, each crossing a point of the graph, so what is left
// has no crossing in it but those points. Each point is numbered between the ends of the stretch it splits, where the graph
// has numbers. Pure: a graph in, changed in place, or edges in and a graph of wires and faces out.

import { blocks, faces, isPlanar } from './planar.js';

const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** What it costs to cross a hidden link: nothing to see, but it is a turn. */
const HIDDEN = 0.1;
/** Spreads the points' numbers, so no two are ever alike. */
const GOLD = 0.618034;

/** Take the nearest off `open`, then the least far on. */
const nextOf = (open, dist, reach) => {
  let k = 0;
  for (let n = 1; n < open.length; n++) if (dist.get(open[n]) < dist.get(open[k]) || (reach && dist.get(open[n]) === dist.get(open[k]) && reach.get(open[n]) < reach.get(open[k]))) k = n;
  return open.splice(k, 1)[0];
};

/** Each stretch's faces. */
const facesBy = (list) => {
  const byEdge = new Map();
  list.forEach((f, i) => f.forEach((a, k) => {
    const e = pair(a, f[(k + 1) % f.length]);
    (byEdge.get(e) ?? byEdge.set(e, []).get(e)).push(i);
  }));
  return byEdge;
};

/**
 * The face nearest all of `near`, by what it costs to reach each from it, leaving out those `barred` says. A new item
 * goes in there, by `put` in `thread`.
 */
export function nearest(near, list, owner, keep, barred) {
  const byEdge = facesBy(list), total = list.map(() => 0);
  for (const v of near) {
    const dist = new Map(), open = [];
    list.forEach((f, i) => { if (f.includes(v)) (dist.set(i, 0), open.push(i)); });
    while (open.length) {
      const i = nextOf(open, dist);
      list[i].forEach((a, k) => {
        const e = pair(a, list[i][(k + 1) % list[i].length]), cost = dist.get(i) + (owner.get(e)?.visible ? 1 : HIDDEN);
        if (e === keep) return;
        for (const n of byEdge.get(e) ?? []) if (n !== i && (!dist.has(n) || cost < dist.get(n))) (dist.set(n, cost), open.push(n));
      });
    }
    list.forEach((_, i) => (total[i] += dist.get(i) ?? list.length));
  }
  let best = -1;
  list.forEach((_, i) => { if (!barred(i) && (best < 0 || total[i] < total[best])) best = i; });
  return best;
}

/** Item `v` into face `i`, numbered as near `want` as it can be, on hidden wires from the face's top to its foot. */
export function put(v, i, want, list, number, add) {
  const f = list[i], low = f.reduce((m, a, k) => (number.get(a) < number.get(f[m]) ? k : m), 0), high = f.reduce((m, a, k) => (number.get(a) > number.get(f[m]) ? k : m), 0);
  const [lo, hi] = [number.get(f[low]), number.get(f[high])], [m, n] = [low, high].sort((p, q) => p - q);
  number.set(v, Math.min(lo + (hi - lo) * 0.9, Math.max(lo + (hi - lo) * 0.1, want)) + (hi - lo) * 1e-3 * ((number.size * GOLD) % 1));
  add([f[low], v], false, null);
  add([v, f[high]], false, null);
  list.splice(i, 1, [...f.slice(m, n + 1), v], [...f.slice(n), ...f.slice(0, m + 1), v]);
}

/**
 * A threader over `list`, the faces: thread each of `links`, a list of [u, v], through them. `owner` says which wire
 * holds each stretch and `add(path, visible, link)` makes a wire. With `onward(link)`, that link only ever goes on through
 * `number`, so it runs from u to v the way the numbers do. The stretch `keep` is never crossed. It keeps count in
 * `tally`: { ghosts, crossings, unthreaded }.
 */
export function threader(list, owner, add, { number, keep, onward = () => false }) {
  const tally = { ghosts: [], crossings: 0, unthreaded: 0 }, at = (v) => number.get(v);
  let made = 0;
  const through = (links) => { for (const l of links) {
    const [u, v] = l, hidden = owner.get(pair(u, v));
    // A hidden wire between the two already: it just shows.
    if (hidden) { Object.assign(hidden, { visible: true, link: l, path: [u, v] }); continue; }
    const byEdge = facesBy(list), strict = onward(l);
    // How far on through the numbers a wire must already be to cross this stretch, or null when it cannot.
    const past = (e, h) => {
      if (e === keep) return null;
      if (!strict) return h;
      const [a, b] = e.split('|'), hi = Math.max(at(a), at(b)), lo = Math.max(h, Math.min(at(a), at(b)));
      return a !== u && b !== u && a !== v && b !== v && lo < hi && lo < at(v) ? lo : null;
    };
    const dist = new Map(), reach = new Map(), prev = new Map(), open = [];
    list.forEach((f, i) => { if (f.includes(u)) (dist.set(i, 0), reach.set(i, strict ? at(u) : 0), open.push(i)); });
    const nearer = (i, d, h) => !dist.has(i) || d < dist.get(i) || (d === dist.get(i) && h < reach.get(i));
    let end = -1;
    while (open.length) {
      const i = nextOf(open, dist, reach);
      if (list[i].includes(v)) { end = i; break; }
      list[i].forEach((a, k) => {
        const e = pair(a, list[i][(k + 1) % list[i].length]), cost = dist.get(i) + (owner.get(e)?.visible ? 1 : HIDDEN), h = past(e, reach.get(i));
        if (h === null) return;
        for (const n of byEdge.get(e) ?? []) if (n !== i && nearer(n, cost, h)) (dist.set(n, cost), reach.set(n, h), prev.set(n, [i, e]), open.push(n));
      });
    }
    if (end < 0) { tally.unthreaded++; continue; }
    const steps = [];
    for (let i = end; prev.has(i); i = prev.get(i)[0]) steps.unshift(prev.get(i)[1]);
    // Each point between what is before it and what it must leave room for.
    const under = steps.map(() => Infinity), points = [];
    if (strict) for (let k = steps.length - 1, top = at(v); k >= 0; k--) {
      const [a, b] = steps[k].split('|');
      top = under[k] = Math.min(top, Math.max(at(a), at(b)));
    }
    let run = strict ? at(u) : -Infinity;
    for (let k = 0; k < steps.length; k++) {
      const e = steps[k], [a, b] = e.split('|'), d = `ghost${made++}`, w = owner.get(e), lo = Math.max(run, Math.min(at(a), at(b)));
      // Never on a number something already has: a face tells its top from its foot by them.
      number.set(d, lo + (Math.min(under[k], Math.max(at(a), at(b))) - lo) * (0.4 + 0.2 * ((made * GOLD) % 1)));
      run = strict ? at(d) : run;
      tally.ghosts.push(d);
      if (w.visible) tally.crossings++;
      for (const f of list) for (let n = 0; n < f.length; n++) {
        const p = f[n], q = f[(n + 1) % f.length];
        if ((p === a && q === b) || (p === b && q === a)) { f.splice(n + 1, 0, d); break; }
      }
      const pos = w.path.findIndex((x, i) => i && pair(w.path[i - 1], x) === e);
      w.path.splice(pos, 0, d);
      owner.delete(e);
      owner.set(pair(a, d), w);
      owner.set(pair(d, b), w);
      points.push(d);
    }
    const path = [u, ...points, v];
    add(path, true, l);
    for (let i = 1; i < path.length; i++) {
      const [p, q] = [path[i - 1], path[i]], hold = list.findIndex((f) => f.includes(p) && f.includes(q));
      if (hold < 0) throw new Error('A threaded wire left its faces');
      const f = list[hold], [m, n] = [f.indexOf(p), f.indexOf(q)].sort((x, y) => x - y);
      list.splice(hold, 1, f.slice(m, n + 1), [...f.slice(n), ...f.slice(0, m + 1)]);
    }
  } };
  return { through, tally };
}

/**
 * Invisible edges until `kept` over `items` is one biconnected piece, each kept only if it stays planar, and each as far
 * as it can be from what the order leaves without a wire out to what it leaves without a wire in, so that it lends both.
 */
function join(kept, items, order) {
  const hidden = [], all = () => [...kept, ...hidden], from = new Set(order.map(([u]) => u)), into = new Set(order.map(([, v]) => v));
  const ends = new Set([...into].filter((v) => !from.has(v))), starts = new Set([...from].filter((v) => !into.has(v)));
  const worth = (a, b) => Number(ends.has(a)) + Number(starts.has(b));
  for (const k of items) if (!all().some(([u, v]) => u === k || v === k)) hidden.push([k, items.find((x) => x !== k)]);
  for (let round = 0; round < 2000; round++) {
    const parts = blocks(all());
    if (parts.length === 1) return hidden;
    const sets = parts.map((p) => new Set(p.flat())), together = (x, y) => sets.some((s) => s.has(x) && s.has(y));
    const bridge = (i, j, c) => {
      const ways = [];
      for (const a of sets[i]) {
        if (a === c || sets[j].has(a)) continue;
        for (const b of sets[j]) if (b !== c && !sets[i].has(b) && !together(a, b)) ways.push(worth(a, b) >= worth(b, a) ? [a, b, worth(a, b)] : [b, a, worth(b, a)]);
      }
      // The sort keeps the order they were found in among equals.
      for (const [a, b, w] of ways.sort((p, q) => q[2] - p[2])) if (isPlanar([...all(), [a, b]])) return void hidden.push(w ? [a, b, true] : [a, b]), true;
      return false;
    };
    let done = false;
    for (let i = 0; i < parts.length && !done; i++) for (let j = i + 1; j < parts.length && !done; j++) {
      const c = [...sets[i]].find((v) => sets[j].has(v));
      if (c !== undefined) done = bridge(i, j, c) !== false && all().length > 0 && Boolean(hidden.length);
    }
    if (!done) for (let i = 0; i < parts.length && !done; i++) for (let j = i + 1; j < parts.length && !done; j++) if (![...sets[i]].some((v) => sets[j].has(v))) done = bridge(i, j) !== false;
    if (!done) return hidden;
  }
  return hidden;
}

/**
 * `links` is a list of [u, v], heaviest first: the graph as { faces, wires, owner, ghosts, crossings }. The heaviest planar
 * part is kept, invisible edges join it into one biconnected piece and the links left out are threaded through its
 * faces. A wire is { path, visible, link }, its path from u to v through the points where it crosses; `owner` says which
 * wire holds each stretch between two neighbours.
 */
export function planarize(links, items) {
  const kept = [], left = [], root = new Map();
  const find = (v) => { let r = v; while (root.has(r)) r = root.get(r); if (r !== v) root.set(v, r); return r; };
  for (const l of links) {
    kept.push(l);
    // A link between two parts not yet joined closes no ring, so only the others are tested.
    const [a, b] = [find(l[0]), find(l[1])];
    if (a !== b) root.set(a, b);
    else if (!isPlanar(kept.map(([u, v]) => [u, v]))) (kept.pop(), left.push(l));
  }
  const edges = kept.map(([u, v]) => [u, v]), hidden = join(edges, items, links.filter((l) => l[2]));
  const wires = [], owner = new Map();
  const add = (path, visible, link) => {
    const w = { path, visible, link };
    wires.push(w);
    for (let i = 1; i < path.length; i++) owner.set(pair(path[i - 1], path[i]), w);
  };
  kept.forEach((l) => add([l[0], l[1]], true, l));
  for (const [u, v, leads] of hidden) if (!owner.has(pair(u, v))) (add([u, v], false, null), (wires.at(-1).leads = leads));
  const list = faces([...owner.keys()].map((k) => k.split('|')));
  if (!list) throw new Error('The kept part is not planar');
  const { through, tally } = threader(list, owner, add, { number: new Map() });
  through(left);
  return { faces: list, wires, owner, ...tally };
}
