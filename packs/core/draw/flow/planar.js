// Planarity for a knot of a graph: its biconnected parts, the faces of a part (Demoucron, Malgrange and Pertuiset), and
// whether edges can be drawn with none crossing. Pure: edges in, answers out.

import { facesOf, leftRight } from './lr.js';
import { pair } from './polyline.js';

/** Past this many edges the faces come from the left-right test, which is far quicker and lies them out another way. */
const QUICK_FACES = 600;

const adjacency = (edges) => {
  const a = new Map();
  for (const [x, y] of edges) {
    (a.get(x) ?? a.set(x, new Set()).get(x)).add(y);
    (a.get(y) ?? a.set(y, new Set()).get(y)).add(x);
  }
  return a;
};

/** The biconnected parts, each a list of edges. */
export function blocks(edges) {
  const a = adjacency(edges), index = new Map(), low = new Map(), stack = [], parts = [];
  let count = 0;
  const walk = (u, from) => {
    index.set(u, count);
    low.set(u, count++);
    for (const v of a.get(u)) {
      if (v === from) continue;
      if (!index.has(v)) {
        stack.push([u, v]);
        walk(v, u);
        low.set(u, Math.min(low.get(u), low.get(v)));
        if (low.get(v) >= index.get(u)) {
          const part = [];
          for (;;) {
            const e = stack.pop();
            part.push(e);
            if (e[0] === u && e[1] === v) break;
          }
          parts.push(part);
        }
      } else if (index.get(v) < index.get(u)) (stack.push([u, v]), low.set(u, Math.min(low.get(u), index.get(v))));
    }
  };
  for (const s of a.keys()) if (!index.has(s)) walk(s, null);
  return parts;
}

/** The faces of a biconnected graph, each a cycle of its items, or null when it is not planar. */
export function faces(edges) {
  if (edges.length > QUICK_FACES) return facesOf(edges);
  const a = adjacency(edges), all = new Map(edges.map(([x, y]) => [pair(x, y), [x, y]]));
  const path = [[...a.keys()][0]];
  let cycle = null;
  for (let prev = null; !cycle; ) {
    const u = path.at(-1), v = [...a.get(u)].find((w) => w !== prev), at = path.indexOf(v);
    if (at >= 0) cycle = path.slice(at);
    else (path.push(v), (prev = u));
  }
  const list = [[...cycle], [...cycle]];
  const doneEdges = new Set(cycle.map((v, i) => pair(v, cycle[(i + 1) % cycle.length]))), doneItems = new Set(cycle);
  while (doneEdges.size < all.size) {
    const frags = [], seen = new Set();
    for (const [k, [x, y]] of all) if (!doneEdges.has(k) && doneItems.has(x) && doneItems.has(y)) frags.push({ touches: new Set([x, y]), inner: new Set() });
    for (const s of a.keys()) {
      if (doneItems.has(s) || seen.has(s)) continue;
      const inner = new Set([s]), touches = new Set(), queue = [s];
      seen.add(s);
      while (queue.length) for (const w of a.get(queue.pop())) {
        if (doneItems.has(w)) touches.add(w);
        else if (!inner.has(w)) (inner.add(w), seen.add(w), queue.push(w));
      }
      frags.push({ touches, inner });
    }
    let best = null;
    for (const f of frags) {
      const fit = list.filter((face) => { const set = new Set(face); return [...f.touches].every((v) => set.has(v)); });
      if (!fit.length) return null;
      if (!best || fit.length < best.fit.length) best = { ...f, fit };
    }
    const [x, y] = [...best.touches];
    let run;
    if (!best.inner.size) run = [x, y];
    else {
      const prev = new Map(), queue = [];
      for (const v of a.get(x)) if (best.inner.has(v) && !prev.has(v)) (prev.set(v, x), queue.push(v));
      for (let i = 0; i < queue.length && !run; i++) {
        const u = queue[i];
        if (a.get(u).has(y)) {
          run = [y, u];
          while (prev.get(run.at(-1)) !== x) run.push(prev.get(run.at(-1)));
          run.push(x);
          run.reverse();
          break;
        }
        for (const v of a.get(u)) if (best.inner.has(v) && !prev.has(v)) (prev.set(v, u), queue.push(v));
      }
    }
    for (let i = 1; i < run.length; i++) doneEdges.add(pair(run[i - 1], run[i]));
    run.forEach((v) => doneItems.add(v));
    const face = best.fit[0], [i, j] = [face.indexOf(x), face.indexOf(y)].sort((p, q) => p - q);
    list.splice(list.indexOf(face), 1);
    const inner = (face[i] === x ? run : [...run].reverse()).slice(1, -1);
    list.push([...face.slice(i, j + 1), ...[...inner].reverse()], [...face.slice(j), ...face.slice(0, i + 1), ...inner]);
  }
  return list;
}

/** Whether these edges can be drawn with none crossing. */
export const isPlanar = (edges) => leftRight(edges) !== null;

/**
 * The heaviest planar part of `links`, a list of [u, v], heaviest first: each kept if it stays planar with those before it,
 * the rest left. Whole runs are tried at once, as what holds of a run holds of each of its links, so the answer is the
 * same as trying them one by one and the test runs about as often as links are left.
 */
export function keptPlanar(links) {
  const kept = [], left = [];
  let size = 1;
  for (let at = 0; at < links.length; ) {
    const run = links.slice(at, at + size);
    if (isPlanar([...kept, ...run])) (kept.push(...run), (at += run.length), (size *= 2));
    else if (run.length > 1) size = run.length >> 1;
    else (left.push(run[0]), at++);
  }
  return { kept, left };
}
