// Planarity for a knot of a graph: its biconnected parts, the faces of a part (Demoucron, Malgrange and Pertuiset), the
// heaviest edges that stay planar, and a drawing of them by Tutte, where nothing crosses, spread by moves that add no
// crossing. Pure: edges in, places out.

const adjacency = (edges) => {
  const a = new Map();
  for (const [x, y] of edges) {
    (a.get(x) ?? a.set(x, new Set()).get(x)).add(y);
    (a.get(y) ?? a.set(y, new Set()).get(y)).add(x);
  }
  return a;
};
const pair = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);

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

/** Whether these edges can be drawn with none crossing. Fewer than nine edges in a part always can. */
export const isPlanar = (edges) => blocks(edges).every((b) => b.length < 9 || faces(b) !== null);

/** Tutte's drawing of a biconnected planar part: its longest face a circle of radius R, every other face given a middle. */
function tutte(edges, R) {
  const list = faces(edges) ?? [], outer = list.reduce((p, q) => (q.length > p.length ? q : p), []);
  const a = adjacency(edges), at = new Map();
  outer.forEach((v, k) => at.set(v, [R * Math.cos((2 * Math.PI * k) / outer.length), R * Math.sin((2 * Math.PI * k) / outer.length)]));
  let passed = false;
  list.forEach((f, k) => {
    if (!passed && f === outer) return void (passed = true);
    if (f.length <= 3) return;
    a.set(`face:${k}`, new Set(f));
    for (const v of f) a.get(v).add(`face:${k}`);
  });
  const inner = [...a.keys()].filter((v) => !at.has(v));
  inner.forEach((v) => at.set(v, [0, 0]));
  for (let t = 0; t < 400; t++) for (const v of inner) {
    let x = 0, y = 0;
    for (const w of a.get(v)) (x += at.get(w)[0]), (y += at.get(w)[1]);
    at.set(v, [x / a.get(v).size, y / a.get(v).size]);
  }
  for (const v of [...at.keys()]) if (String(v).startsWith('face:')) at.delete(v);
  return at;
}

const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export const crosses = (p, q, r, s) => side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0;

/** Push the knot apart and pull wires short, a move kept only if its wires cross no more than before. */
function spread(knots, edges, at, reach, unit) {
  const near = new Map(knots.map((k) => [k, []]));
  for (const [u, v] of edges) (near.get(u).push(v), near.get(v).push(u));
  const hits = (id, to) => {
    let c = 0;
    for (const w of near.get(id)) for (const [u, v, carried] of edges) if (u !== id && v !== id && u !== w && v !== w && crosses(to, at.get(w), at.get(u), at.get(v))) c += carried;
    return c;
  };
  for (let t = 0; t < 30; t++) {
    const step = unit * 0.6 * (1 - t / 30) + unit * 0.05;
    for (const id of knots) {
      const p = at.get(id);
      let fx = 0, fy = 0;
      for (const other of knots) {
        if (other === id) continue;
        const q = at.get(other), dx = p[0] - q[0], dy = p[1] - q[1], l = Math.hypot(dx, dy) || 1, want = reach(id) + reach(other) + unit;
        if (l < want * 2) ((fx += ((dx / l) * (want * 2 - l)) / want), (fy += ((dy / l) * (want * 2 - l)) / want));
      }
      for (const w of near.get(id)) {
        const q = at.get(w), dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, want = reach(id) + reach(w) + unit;
        fx += ((dx / l) * (l - want)) / want;
        fy += ((dy / l) * (l - want)) / want;
      }
      const f = Math.hypot(fx, fy) || 1, to = [p[0] + (fx / f) * step, p[1] + (fy / f) * step];
      if (hits(id, to) <= hits(id, p)) at.set(id, to);
    }
  }
}

/** Places for a knot from its heaviest planar part: `weighted` is [u, v, wires carried]. Sets them in `at`. */
export function planarPlaces({ knots, weighted, reach, at, unit }) {
  const kept = [];
  for (const e of [...weighted].sort((p, q) => q[2] - p[2])) {
    kept.push(e);
    if (!isPlanar(kept.map(([u, v]) => [u, v]))) kept.pop();
  }
  const parts = blocks(kept.map(([u, v]) => [u, v])).sort((p, q) => q.length - p.length), done = new Set();
  const middle = () => {
    let x = 0, y = 0;
    for (const id of done) ((x += at.get(id)[0]), (y += at.get(id)[1]));
    return [x / (done.size || 1), y / (done.size || 1)];
  };
  while (parts.length) {
    const found = parts.findIndex((b) => b.some(([u, v]) => done.has(u) || done.has(v)));
    const [b] = parts.splice(Math.max(found, 0), 1), items = [...new Set(b.flat())], anchor = items.find((v) => done.has(v)), c = middle(), first = !done.size;
    if (b.length === 1) {
      const from = anchor ?? b[0][0], to = items.find((v) => v !== from);
      if (!done.has(from)) (at.set(from, [c[0] + done.size * 7, c[1]]), done.add(from));
      if (!done.has(to)) {
        const p = at.get(from), th = Math.atan2(p[1] - c[1], p[0] - c[0]) + ((parts.length % 7) - 3) * 0.25, l = reach(from) + reach(to) + unit;
        at.set(to, [p[0] + l * Math.cos(th), p[1] + l * Math.sin(th)]);
        done.add(to);
      }
      continue;
    }
    const drawn = tutte(b, unit * Math.sqrt(items.length) * (first ? 2.2 : 1.1));
    if (anchor !== undefined && drawn.has(anchor)) {
      const p = at.get(anchor), base = drawn.get(anchor);
      let mx = 0, my = 0;
      for (const q of drawn.values()) ((mx += q[0] / drawn.size), (my += q[1] / drawn.size));
      const turn = Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(my - base[1], mx - base[0]), cs = Math.cos(turn), sn = Math.sin(turn);
      for (const [v, q] of drawn) if (!done.has(v)) {
        const dx = q[0] - base[0], dy = q[1] - base[1];
        at.set(v, [p[0] + dx * cs - dy * sn, p[1] + dx * sn + dy * cs]);
        done.add(v);
      }
    } else for (const [v, q] of drawn) if (!done.has(v)) (at.set(v, q), done.add(v));
  }
  knots.forEach((id, k) => { if (!done.has(id)) (at.set(id, [(k % 10) * unit, 3 * unit]), done.add(id)); });
  spread(knots, weighted, at, reach, unit);
}
