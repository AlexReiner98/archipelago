// A graph drawn from its planar embedding as a visibility representation (Tamassia and Tollis): each item a bar across a
// run of columns, each wire straight down a column from one bar to another, so the planar part cannot cross and every
// wire is at right angles. An st-numbering sets the rows, the faces between the wires set the columns, and the longest
// path through each keeps both as tight as they can be. Trees hang in combs beside their item. Pure: an answer in,
// geometry out, as the flow's layout answers.

import { comb, peel } from './combs.js';
import { flatten, ORDER } from './graph.js';
import { stepsOf } from './plane.js';
import { planarize } from './thread.js';

let last = null;
/** What the last layout drew, for the count in the key. */
export const latest = () => last;
const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The items of a biconnected graph in an order where each but `s` and `t` has a neighbour before it and one after (Tarjan). */
function stNumber(next, s, t) {
  const order = [], parent = new Map(), pre = new Map(), low = new Map();
  const walk = (v, from) => {
    pre.set(v, order.length);
    low.set(v, v);
    order.push(v);
    for (const w of next.get(v)) {
      if (!pre.has(w)) {
        parent.set(w, v);
        walk(w, v);
        if (pre.get(low.get(w)) < pre.get(low.get(v))) low.set(v, low.get(w));
      } else if (w !== from && pre.get(w) < pre.get(low.get(v))) low.set(v, w);
    }
  };
  pre.set(t, 0);
  low.set(t, t);
  order.push(t);
  parent.set(s, t);
  walk(s, t);
  for (const w of next.get(t)) if (!pre.has(w)) throw new Error('The graph is not connected');
  const before = new Map([[t, s]]), after = new Map([[s, t]]), sign = new Map([[s, -1]]);
  const put = (v, l, r) => {
    if (l !== undefined) after.set(l, v);
    if (r !== undefined) before.set(r, v);
    if (l !== undefined) before.set(v, l); else before.delete(v);
    if (r !== undefined) after.set(v, r); else after.delete(v);
  };
  for (const v of order.slice(2)) {
    const p = parent.get(v);
    if (sign.get(low.get(v)) === -1) (put(v, before.get(p), p), sign.set(p, 1));
    else (put(v, p, after.get(p)), sign.set(p, -1));
  }
  const number = new Map();
  let at = s, k = 0;
  while (at !== undefined) (number.set(at, k++), (at = after.get(at)));
  return number;
}

/** Each stretch's face to its left and right, walking out from the outer face; each face's two sides. */
function sidesOf(list, outerAt, number, s, t) {
  const byEdge = new Map();
  list.forEach((f, i) => f.forEach((a, k) => {
    const e = pair(a, f[(k + 1) % f.length]);
    (byEdge.get(e) ?? byEdge.set(e, []).get(e)).push(i);
  }));
  const chains = (f) => {
    const low = f.reduce((m, v, i) => (number.get(v) < number.get(f[m]) ? i : m), 0), n = f.length;
    const run = (step) => {
      const out = [];
      for (let i = low; ; i = (i + step + n) % n) {
        const j = (i + step + n) % n;
        out.push(pair(f[i], f[j]));
        if (number.get(f[j]) < number.get(f[i])) throw new Error('A face has more than one top');
        if (number.get(f[(j + step + n) % n]) < number.get(f[j]) || (j + step + n) % n === low) break;
      }
      return out;
    };
    return [run(1), run(-1)];
  };
  const left = new Map(), right = new Map(), LEFT = -1, RIGHT = -2, seen = new Set([outerAt]);
  const other = (e, i) => (byEdge.get(e) ?? []).find((f) => f !== i);
  const visit = (i, e, isRight) => {
    if (seen.has(i)) return;
    seen.add(i);
    const [a, b] = chains(list[i]), near = a.includes(e) ? a : b, far = near === a ? b : a;
    for (const x of near) (isRight ? right : left).set(x, i);
    for (const x of far) (isRight ? left : right).set(x, i);
    for (const x of near) { const o = other(x, i); if (o !== undefined && o !== outerAt) visit(o, x, !isRight); }
    for (const x of far) { const o = other(x, i); if (o !== undefined && o !== outerAt) visit(o, x, isRight); }
  };
  const st = pair(s, t), [a, b] = chains(list[outerAt]), [mine, rest] = a.length === 1 && a[0] === st ? [a, b] : [b, a];
  right.set(mine[0], RIGHT);
  for (const e of rest) left.set(e, LEFT);
  const inside = other(st, outerAt);
  visit(inside, st, false);
  for (const e of rest) { const o = other(e, outerAt); if (o !== undefined) visit(o, e, true); }
  for (const e of byEdge.keys()) if (!left.has(e) || !right.has(e)) throw new Error('A stretch has no side');
  return { left, right, LEFT, RIGHT };
}

/** The longest path to each of `count` nodes (with extra names), over arcs [from, to, length]. */
function longest(names, arcs) {
  const out = new Map(names.map((n) => [n, []])), degree = new Map(names.map((n) => [n, 0])), at = new Map(names.map((n) => [n, 0]));
  for (const [p, q, l] of arcs) (out.get(p).push([q, l]), degree.set(q, degree.get(q) + 1));
  const queue = names.filter((n) => !degree.get(n));
  for (let k = 0; k < queue.length; k++) for (const [q, l] of out.get(queue[k])) {
    at.set(q, Math.max(at.get(q), at.get(queue[k]) + l));
    degree.set(q, degree.get(q) - 1);
    if (!degree.get(q)) queue.push(q);
  }
  if (queue.length !== names.length) throw new Error('The columns go in a ring');
  return at;
}

/** One connected part: places by item, and each visible link's points. `block` is an item's size with what hangs on it. */
function drawPart(list, links, block, z) {
  const g = planarize(links, list), next = new Map();
  for (const k of g.owner.keys()) {
    const [a, b] = k.split('|');
    (next.get(a) ?? next.set(a, new Set()).get(a)).add(b);
    (next.get(b) ?? next.set(b, new Set()).get(b)).add(a);
  }
  const outerAt = g.faces.reduce((m, f, i) => (f.length > g.faces[m].length ? i : m), 0), outer = g.faces[outerAt];
  // The top and foot on the outer face that leave the order running down most.
  const order = links.filter((l) => l[2]);
  let best = null, least = Infinity;
  for (let i = 0; i < outer.length; i++) for (const [s, t] of [[outer[i], outer[(i + 1) % outer.length]], [outer[(i + 1) % outer.length], outer[i]]]) {
    const number = stNumber(next, s, t), up = order.filter(([u, v]) => number.get(u) > number.get(v)).length;
    if (up < least) ((least = up), (best = { s, t, number }));
  }
  const { s, t, number } = best, { left, right, LEFT, RIGHT } = sidesOf(g.faces, outerAt, number, s, t);
  const ghost = (v) => v.startsWith('ghost'), size = (v) => (ghost(v) ? { w: 0, h: z.turn } : block(v));
  const rows = [...number.keys()], yArcs = [];
  for (const k of g.owner.keys()) {
    const [a, b] = k.split('|'), [u, v] = number.get(a) < number.get(b) ? [a, b] : [b, a];
    yArcs.push([u, v, size(u).h + z.row]);
  }
  const y = longest(rows, yArcs);
  // Each item's bar runs from the face that is only ever on the left of its wires to the one only ever on the right.
  const lefts = new Map(), rights = new Map();
  for (const k of g.owner.keys()) for (const v of k.split('|')) {
    (lefts.get(v) ?? lefts.set(v, new Set()).get(v)).add(left.get(k));
    (rights.get(v) ?? rights.set(v, new Set()).get(v)).add(right.get(k));
  }
  const ends = new Map(rows.map((v) => [v, [[...lefts.get(v)].find((f) => !rights.get(v).has(f)) ?? LEFT, [...rights.get(v)].find((f) => !lefts.get(v).has(f)) ?? RIGHT]]));
  const names = [LEFT, RIGHT, ...g.faces.map((_, i) => i).filter((i) => i !== outerAt)], xArcs = [];
  for (const k of g.owner.keys()) xArcs.push([left.get(k), right.get(k), z.col]);
  for (const v of rows) if (!ghost(v)) xArcs.push([ends.get(v)[0], ends.get(v)[1], size(v).w + z.col]);
  const x = longest(names, xArcs);
  const middle = (v) => (x.get(ends.get(v)[0]) + x.get(ends.get(v)[1]) + z.col) / 2 - (ghost(v) ? 0 : 0);
  const turned = new Map(), points = new Map();
  for (const w of g.wires) {
    if (!w.visible) continue;
    const out = [], { path } = w;
    const face = (v, to) => (number.get(to) > number.get(v) ? y.get(v) + size(v).h : y.get(v));
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]], col = x.get(left.get(pair(a, b))) + z.col / 2;
      const ya = ghost(a) ? turned.get(`${a} ${w.link}`) : face(a, b);
      if (!ghost(a)) out.push([middle(a), ya]);
      out.push([col, ya]);
      const yb = ghost(b) ? (turned.get(`${b} ${w.link}`) ?? (turned.set(b, (turned.get(b) ?? -1) + 1), turned.set(`${b} ${w.link}`, y.get(b) + turned.get(b) * z.turn), turned.get(`${b} ${w.link}`))) : face(b, a);
      out.push([col, yb]);
      if (!ghost(b)) out.push([middle(b), yb]);
    }
    points.set(pair(w.link[0], w.link[1]), { from: w.link[0], points: out });
  }
  const places = new Map(rows.filter((v) => !ghost(v)).map((v) => [v, [middle(v), y.get(v)]]));
  return { places, points, crossings: g.crossings };
}

export function layout({ items: given, links: told = [], undrawn = [], placed = {}, measure, sizes, aspect = 1.6 }) {
  const { items, links } = flatten({ items: given, links: told, undrawn });
  const { nodes, edges, potential } = stepsOf({ items, links, measure, sizes });
  const margin = sizes.flow_margin, gap = sizes.flow_node_gap, z = { row: sizes.flow_layer_gap / 2, col: gap / 2, turn: gap / 3, gap };
  const zc = { row: gap / 4, col: gap };
  const ties = links.filter((l) => l.type !== ORDER).map((l) => ({ a: l.from, b: l.to, type: l.type, ...(l.pending && { pending: l.pending }) }));
  const chains = edges.map((e) => ({ ...e, key: `${e.a} ${e.b}`, path: [e.a, e.b], dashed: potential.has(e.b) }));
  const every = [...chains, ...ties], stepSize = (id) => nodes.get(id);
  const a = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const w of every) if (w.a !== w.b && a.has(w.a) && a.has(w.b)) (a.get(w.a).add(w.b), a.get(w.b).add(w.a));
  const { kids, core } = peel(a);
  const combs = new Map(core.map((id) => [id, comb(id, kids, stepSize, zc)]));
  const block = (id) => {
    const s = stepSize(id), c = combs.get(id);
    return c?.items.length ? { w: s.w + gap + c.w, h: Math.max(s.h, s.h / 2 + c.h) } : { w: s.w, h: s.h };
  };
  const inCore = new Set(core), seen = new Set(), parts = [];
  for (const s of core) {
    if (seen.has(s)) continue;
    const list = [s];
    seen.add(s);
    for (let k = 0; k < list.length; k++) for (const w of a.get(list[k])) if (inCore.has(w) && !seen.has(w)) (seen.add(w), list.push(w));
    parts.push(list);
  }
  const orderKey = new Set(chains.map((c) => pair(c.a, c.b))), x = new Map(), y = new Map(), routes = new Map(), shelves = [];
  let threaded = 0;
  for (const list of parts) {
    const own = new Set(list), done = new Set(), part = [];
    // Links of this part, the order first, so it is what stays planar; each with whether it is the order.
    for (const w of [...every].sort((p, q) => Number(q.path !== undefined) - Number(p.path !== undefined))) {
      const k = pair(w.a, w.b);
      if (w.a !== w.b && own.has(w.a) && own.has(w.b) && !done.has(k)) (done.add(k), part.push([w.path ? w.a : w.b, w.path ? w.b : w.a, orderKey.has(k)]));
    }
    let drawn;
    if (list.length >= 3 && part.length >= 3) {
      try { drawn = drawPart(list, part, block, z); threaded += drawn.crossings; } catch (e) { console.warn?.(`The bars fell back: ${e.message}`); }
    }
    if (!drawn) {
      let run = 0;
      drawn = { places: new Map(list.map((id) => { const p = [0, run]; run += block(id).h + z.row; return [id, p]; })), points: new Map(), crossings: 0 };
    }
    const xs = [...drawn.places].flatMap(([id, [px]]) => [px - block(id).w / 2, px + block(id).w / 2]), ys = [...drawn.places].flatMap(([id, [, py]]) => [py, py + block(id).h]);
    const wired = [...drawn.points.values()].flatMap((r) => r.points);
    const l = Math.min(...xs, ...wired.map((p) => p[0])), t = Math.min(...ys, ...wired.map((p) => p[1]));
    shelves.push({ drawn, l, t, w: Math.max(...xs, ...wired.map((p) => p[0])) - l, h: Math.max(...ys, ...wired.map((p) => p[1])) - t });
  }
  shelves.sort((p, q) => q.h - p.h || q.w - p.w);
  const area = shelves.reduce((s, c) => s + (c.w + gap) * (c.h + gap), 0), most = Math.max(shelves[0]?.w ?? 0, Math.sqrt(area * aspect));
  let sx = margin, sy = margin, row = 0;
  const parents = new Map();
  const note = (holder) => (kids.get(holder) ?? []).forEach((k) => (parents.set(k, holder), note(k)));
  for (const c of shelves) {
    if (sx > margin && sx + c.w > margin + most) ((sx = margin), (sy += row + gap), (row = 0));
    const dx = sx - c.l, dy = sy - c.t;
    for (const [id, [px, py]] of c.drawn.places) {
      const s = stepSize(id), hang = combs.get(id), b = block(id), boxX = px - b.w / 2 + s.w / 2 + dx, boxY = py + s.h / 2 + dy;
      x.set(id, boxX);
      y.set(id, boxY);
      if (hang?.items.length) {
        note(id);
        const ax = px - b.w / 2 + s.w + gap + hang.w / 2 + dx, map = ([p, q]) => [ax + p, boxY + q];
        for (const it of hang.items) (x.set(it.id, map([it.x, it.y])[0]), y.set(it.id, map([it.x, it.y])[1]));
        for (const [item, points] of hang.wires) {
          const from = parents.get(item), line = points.map(map);
          routes.set(pair(from, item), { from, points: from === id ? [[boxX + s.w / 2, boxY], [ax, boxY], ...line.slice(1)] : line });
        }
      }
    }
    for (const [k, r] of c.drawn.points) routes.set(k, { from: r.from, points: r.points.map(([p, q]) => [p + dx, q + dy]) });
    sx += c.w + gap;
    row = Math.max(row, c.h);
  }
  for (const id of Object.keys(placed)) if (nodes.has(id) && Array.isArray(placed[id])) (x.set(id, Number(placed[id][0])), y.set(id, Number(placed[id][1])));
  const edge = (id, to) => {
    const s = stepSize(id), [px, py] = [x.get(id), y.get(id)], dx = to[0] - px, dy = to[1] - py, t = Math.min(dx ? s.w / 2 / Math.abs(dx) : Infinity, dy ? s.h / 2 / Math.abs(dy) : Infinity, 1);
    return [px + dx * t, py + dy * t];
  };
  for (const w of every) {
    const r = routes.get(pair(w.a, w.b));
    w.points = r ? (r.from === w.a ? r.points : [...r.points].reverse()) : [edge(w.a, [x.get(w.b), y.get(w.b)]), edge(w.b, [x.get(w.a), y.get(w.a)])];
    w.headAt = 'end';
  }
  const all = [...nodes.values()].filter((n) => x.has(n.id)), drawnPoints = every.flatMap((w) => w.points);
  const width = Math.max(0, ...all.map((n) => x.get(n.id) + n.w / 2), ...drawnPoints.map((p) => p[0])) + margin;
  const height = Math.max(0, ...all.map((n) => y.get(n.id) + n.h / 2), ...drawnPoints.map((p) => p[1])) + margin;
  last = { chains, ties, threaded };
  return { nodes, all, chains, ties, breaks: [], potential, x, y, width, height };
}
