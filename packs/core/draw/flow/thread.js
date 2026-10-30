// A graph made planar, ready to draw. The heaviest planar part is kept; invisible edges join it into one biconnected
// piece; each link left out is threaded through the faces, its crossings becoming points of the graph. What comes back
// has no crossing left in it but those points. Pure: edges in, a graph of wires and faces out.

import { blocks, faces, isPlanar } from './planar.js';

const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Invisible edges until `kept` over `items` is one biconnected piece, each kept only if it stays planar. */
function join(kept, items) {
  const hidden = [], all = () => [...kept, ...hidden];
  for (const k of items) if (!all().some(([u, v]) => u === k || v === k)) hidden.push([k, items.find((x) => x !== k)]);
  for (let round = 0; round < 2000; round++) {
    const parts = blocks(all());
    if (parts.length === 1) return hidden;
    const sets = parts.map((p) => new Set(p.flat())), together = (x, y) => sets.some((s) => s.has(x) && s.has(y));
    const bridge = (i, j, c) => {
      for (const a of sets[i]) {
        if (a === c || sets[j].has(a)) continue;
        for (const b of sets[j]) {
          if (b === c || sets[i].has(b) || together(a, b)) continue;
          if (isPlanar([...all(), [a, b]])) return void hidden.push([a, b]), true;
        }
      }
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
 * `links` is a list of [u, v], heaviest first: the graph as { faces, wires, owner, ghosts, crossings }. A wire is
 * { path, visible, link }, its path from u to v through the points where it crosses; `owner` says which wire holds each
 * stretch between two neighbours.
 */
export function planarize(links, items) {
  const kept = [], left = [];
  for (const l of links) {
    kept.push(l);
    if (!isPlanar(kept.map(([u, v]) => [u, v]))) (kept.pop(), left.push(l));
  }
  const edges = kept.map(([u, v]) => [u, v]), hidden = join(edges, items);
  const wires = [], owner = new Map();
  const add = (path, visible, link) => {
    const w = { path, visible, link };
    wires.push(w);
    for (let i = 1; i < path.length; i++) owner.set(pair(path[i - 1], path[i]), w);
  };
  kept.forEach((l) => add([l[0], l[1]], true, l));
  for (const [u, v] of hidden) if (!owner.has(pair(u, v))) add([u, v], false, null);
  const list = faces([...owner.keys()].map((k) => k.split('|')));
  if (!list) throw new Error('The kept part is not planar');
  let crossings = 0, unthreaded = 0, made = 0;
  const ghosts = [];
  for (const l of left) {
    const [u, v] = l, byEdge = new Map();
    list.forEach((f, i) => f.forEach((a, k) => {
      const e = pair(a, f[(k + 1) % f.length]);
      (byEdge.get(e) ?? byEdge.set(e, []).get(e)).push(i);
    }));
    const dist = new Map(), prev = new Map(), open = [];
    list.forEach((f, i) => { if (f.includes(u)) (dist.set(i, 0), open.push(i)); });
    let end = -1;
    while (open.length) {
      open.sort((p, q) => dist.get(q) - dist.get(p));
      const i = open.pop();
      if (list[i].includes(v)) { end = i; break; }
      list[i].forEach((a, k) => {
        const e = pair(a, list[i][(k + 1) % list[i].length]), cost = dist.get(i) + (owner.get(e)?.visible ? 1 : 0);
        for (const n of byEdge.get(e) ?? []) if (n !== i && (!dist.has(n) || cost < dist.get(n))) (dist.set(n, cost), prev.set(n, [i, e]), open.push(n));
      });
    }
    if (end < 0) { unthreaded++; continue; }
    const steps = [];
    for (let i = end; prev.has(i); i = prev.get(i)[0]) steps.unshift(prev.get(i)[1]);
    const points = [];
    for (const e of steps) {
      const [a, b] = e.split('|'), d = `ghost${made++}`, w = owner.get(e);
      ghosts.push(d);
      if (w.visible) crossings++;
      for (const f of list) for (let k = 0; k < f.length; k++) {
        const p = f[k], q = f[(k + 1) % f.length];
        if ((p === a && q === b) || (p === b && q === a)) { f.splice(k + 1, 0, d); break; }
      }
      const at = w.path.findIndex((x, i) => i && pair(w.path[i - 1], x) === e);
      w.path.splice(at, 0, d);
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
  }
  return { faces: list, wires, owner, ghosts, crossings, unthreaded };
}
