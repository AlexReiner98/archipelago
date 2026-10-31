// Every box edge and wire stretch placed by one solve, axis by axis: each is a number, and each pair that stands beside one
// another keeps a least distance, by what the two are. The distance is asked for, not kept as found, so wires too near are
// moved apart and no two wires share a line. Order on an axis is read off the drawing as given, so nothing crossed is undone
// and nothing new is crossed. What is held stays where it stands and the rest keeps its distances from it, so a first draw
// and a step put by hand are the same pass with different things held. Layer: metrics. Pure: places and lines in, changed in place.

import { pair, tidy } from './polyline.js';
import { shelve } from './shelves.js';

/** How far apart two things must be across, to count as beside one another. */
const TOUCH = 0.5;

/** How many times the arcs are gone over, at most: past it they ask for more than can be. */
const PASSES = 400;

/** How far each distance gives way, in turn, where what is held leaves too little room. */
const SQUEEZE = [1, 0.5, 0.25];

/** The numbers in an order every arc runs forward in, with what leaves each; null where they go in a ring. */
function ordered(n, arcs) {
  const out = Array.from({ length: n }, () => []), degree = new Array(n).fill(0);
  for (const [p, q, l] of arcs) (out[p].push([q, l]), degree[q]++);
  const queue = [];
  for (let k = 0; k < n; k++) if (!degree[k]) queue.push(k);
  for (let k = 0; k < queue.length; k++) for (const [q] of out[queue[k]]) if (!--degree[q]) queue.push(q);
  return queue.length === n ? { queue, out } : null;
}

/**
 * `arcs` with those that close a ring left out, as few as can be found: where nothing is free to go next, what has least
 * still waiting goes, and its waiting arcs with it. `told.rings` counts them. An order read off a drawing can fail when a
 * line has come apart, and a drawing must still draw.
 */
function unringed(n, arcs, told) {
  const into = Array.from({ length: n }, () => []), out = Array.from({ length: n }, () => []), degree = new Array(n).fill(0), gone = new Set(), done = new Array(n).fill(false);
  arcs.forEach((a, k) => (out[a[0]].push(k), into[a[1]].push(k), degree[a[1]]++));
  const queue = [];
  for (let v = 0; v < n; v++) if (!degree[v]) queue.push(v);
  for (let k = 0; k < n; k++) {
    if (k === queue.length) {
      let v = -1;
      for (let u = 0; u < n; u++) if (!done[u] && !queue.includes(u) && (v < 0 || degree[u] < degree[v])) v = u;
      for (const a of into[v]) if (!done[arcs[a][0]]) (gone.add(a), told.rings++);
      degree[v] = 0;
      queue.push(v);
    }
    done[queue[k]] = true;
    for (const a of out[queue[k]]) if (!gone.has(a) && !--degree[arcs[a][1]]) queue.push(arcs[a][1]);
  }
  return arcs.filter((_, k) => !gone.has(k));
}

/** The least numbers that keep every arc [from, to, length], which may be negative; with those still moving, if they cannot all be kept. */
function least(n, arcs) {
  const at = new Array(n).fill(0);
  for (let pass = 0; pass < PASSES; pass++) {
    const moved = new Set();
    for (const [p, q, l] of arcs) if (at[p] + l > at[q] + 1e-6) ((at[q] = at[p] + l), moved.add(q));
    if (!moved.size) return { at, moved };
    if (pass === PASSES - 1) return { at: null, moved };
  }
  return { at, moved: new Set() };
}

/** The longest way from `low` to `high` over what stands between them in `order`: the least a box can measure. */
function reach({ queue, out }, spot, low, high) {
  const far = new Map([[low, 0]]);
  for (let k = spot[low]; k <= spot[high]; k++) {
    const from = far.get(queue[k]);
    if (from === undefined) continue;
    for (const [q, l] of out[queue[k]]) if (spot[q] <= spot[high] && from + l > (far.get(q) ?? -Infinity)) far.set(q, from + l);
  }
  return far.get(high);
}

/** Each number not `held`, as near where it stands as arcs a `scale` of their length let it; with no room, null, or if `anyway` it keeps its order. */
function fitted(places, held, arcs, { queue, out }, scale, anyway = false) {
  const floor = places.map((v, k) => (held.has(k) ? v : -Infinity)), roof = places.map((v, k) => (held.has(k) ? v : Infinity));
  for (const [p, q, l] of arcs) {
    if (held.has(p) && !held.has(q)) floor[q] = Math.max(floor[q], places[p] + l * scale);
    if (held.has(q) && !held.has(p)) roof[p] = Math.min(roof[p], places[q] - l * scale);
  }
  for (const v of queue) for (const [q, l] of out[v]) floor[q] = Math.max(floor[q], floor[v] + l * scale);
  for (const v of [...queue].reverse()) for (const [q, l] of out[v]) roof[v] = Math.min(roof[v], roof[q] - l * scale);
  const at = [...places];
  for (const v of queue) {
    if (held.has(v)) continue;
    if (floor[v] > roof[v] && !anyway) return null;
    at[v] = floor[v] > roof[v] ? floor[v] : Math.min(roof[v], Math.max(floor[v], places[v]));
    for (const [q, l] of out[v]) floor[q] = Math.max(floor[q], at[v] + l * scale);
  }
  return at;
}

/**
 * Each number that is not `held`, as near where it stands as every arc lets it. Between what is held there may not be room
 * for all that asks for it: then every distance gives way alike, in `SQUEEZE` steps, so nothing changes order or runs into a
 * box; `told.squeezed` counts those passes. With no room at any of them, what has none keeps its order past what is held.
 */
function within(places, held, given, told) {
  const among = given.filter(([p, q]) => !held.has(p) && !held.has(q)), free = ordered(places.length, among) ? given : [...given.filter(([p, q]) => held.has(p) || held.has(q)), ...unringed(places.length, among, told)];
  const arcs = free, order = ordered(places.length, arcs.filter(([p, q]) => !held.has(p) && !held.has(q)));
  for (const scale of SQUEEZE) {
    const at = fitted(places, held, arcs, order, scale);
    if (at) return at;
    told.squeezed++;
  }
  return fitted(places, held, arcs, order, SQUEEZE.at(-1), true);
}

/** Every number free: the least that keeps every arc, boxes rigid where they can be, leaning neither way. */
function freely(places, given, boxes, told) {
  const arcs = ordered(places.length, given) ? given : unringed(places.length, given, told), order = ordered(places.length, arcs);
  // A box is as big as its name and what lands on it need, and no bigger: that much and it stands rigid, so what stands
  // beside its ports moves the box and never stretches it.
  const spot = [];
  order.queue.forEach((v, k) => (spot[v] = k));
  const rigid = new Map(boxes.map((b) => [b, [b.high, b.low, -reach(order, spot, b.low, b.high)]]));
  // Gone over in the order they run, a pass carries a number as far as it goes.
  arcs.sort((p, q) => spot[p[0]] - spot[q[0]]);
  let first;
  for (;;) {
    const tried = least(places.length, [...arcs, ...rigid.values()]);
    if (tried.at) { first = tried.at; break; }
    // What cannot stand rigid gives way: a box whose ports are held further apart than it measures.
    let freed = 0;
    for (const [b] of rigid) if (tried.moved.has(b.low) || tried.moved.has(b.high)) (rigid.delete(b), freed++);
    if (!freed) throw new Error('The solve cannot keep every distance');
    told.freed += freed;
  }
  const all = [...arcs, ...rigid.values()];
  // As far toward the low side as can be, and as far toward the high: halfway keeps every distance, and leans neither way.
  const end = Math.max(...first), back = least(places.length, all.map(([p, q, l]) => [q, p, l]).sort((p, q) => spot[q[0]] - spot[p[0]])).at;
  return back ? first.map((v, k) => (v + end - back[k]) / 2) : first;
}

/** Stretches on one place that lie along one another, each told which side it belongs on by how it leaves the rest. */
function sides(group, axis) {
  const least = Math.min(...group.map((s) => s.lo)), most = Math.max(...group.map((s) => s.hi));
  for (const s of group) {
    const p = s.line.points, before = p[s.i - 2], after = p[s.i + 1], [from, to] = [p[s.i - 1], p[s.i]];
    const turn = (next, near) => (next ? Math.sign(next[axis] - near[axis]) : 0), [low, high] = from[1 - axis] <= to[1 - axis] ? [turn(before, from), turn(after, to)] : [turn(after, to), turn(before, from)];
    s.tie = low * (s.lo - least + 1) + high * (most - s.hi + 1);
  }
}

/** One pass along `axis`, 0 across and 1 down. */
function pass(axis, { lines, boxes, wire, room, run, corner, apart, join = apart, told, still }) {
  const other = 1 - axis, stretches = [], places = [];
  const number = (value) => (places.push(value), places.length - 1);
  for (const b of boxes) ((b.low = number(b.at[axis] - b.size[axis] / 2)), (b.high = number(b.at[axis] + b.size[axis] / 2)));
  for (const line of lines) {
    const p = (line.points = tidy(bent(line.points)));
    // Which ends come across a box's side is read now: the points beside them move below.
    line.across = [p.length > 1 && p[0][axis] !== p[1][axis], p.length > 1 && p.at(-1)[axis] !== p.at(-2)[axis]];
    for (let i = 1; i < p.length; i++) if (p[i - 1][axis] === p[i][axis]) {
      const s = { line, i, at: p[i][axis], lo: Math.min(p[i - 1][other], p[i][other]), hi: Math.max(p[i - 1][other], p[i][other]), tie: 0, own: [i === 1 && line.a, i === p.length - 1 && line.b].filter(Boolean) };
      stretches.push(s);
    }
  }
  const byPlace = new Map();
  for (const s of stretches) (byPlace.get(s.at) ?? byPlace.set(s.at, []).get(s.at)).push(s);
  for (const group of byPlace.values()) if (group.length > 1) sides(group, axis);
  stretches.sort((p, q) => p.at - q.at || p.tie - q.tie);
  for (const s of stretches) s.n = number(s.at);
  const arcs = [];
  for (const b of boxes) arcs.push([b.low, b.high, b.named[axis]]);
  // A wire's end stands on its box, inside its corners.
  for (const s of stretches) for (const line of s.own) {
    const b = lines.box.get(line), inset = Math.min(corner, b.size[axis] / 3);
    arcs.push([b.low, s.n, inset], [s.n, b.high, inset]);
  }
  // Each thing keeps its distance from what it can see on the low side: what stands behind that is kept off by the chain.
  const facing = (p, q) => {
    if (p.line && q.line) return [p.n, q.n, p.line === q.line ? 0 : wire];
    if (p.line) return p.own.includes(q.id) ? null : [p.n, q.low, p.line.a === q.id || p.line.b === q.id ? run : room];
    if (q.line) return q.own.includes(p.id) ? null : [p.high, q.n, q.line.a === p.id || q.line.b === p.id ? run : room];
    // Two boxes that overlap are parted on the axis that takes least: on the other they stand side by side, in no order.
    const on = (ax) => (p.size[ax] + q.size[ax]) / 2 - Math.abs(p.at[ax] - q.at[ax]);
    return on(axis) > on(other) ? null : [p.high, q.low, lines.joined?.has(pair(p.id, q.id)) ? join : apart];
  };
  const placed = [...stretches, ...boxes.map((b) => Object.assign(b, { key: b.at[axis], lo: b.at[other] - b.size[other] / 2, hi: b.at[other] + b.size[other] / 2 }))];
  for (const s of stretches) s.key = s.at;
  const seen = [];
  for (const it of placed.sort((p, q) => p.key - q.key || (p.tie ?? 0) - (q.tie ?? 0))) {
    const [lo, hi] = [it.lo - TOUCH, it.hi + TOUCH], first = seen.findIndex((v) => v.hi >= lo);
    const from = first < 0 ? seen.length : first, met = new Set();
    let to = from;
    for (; to < seen.length && seen[to].lo <= hi; to++) met.add(seen[to].it);
    // A wire's own box and what stands behind it are looked past that wire: it hides neither.
    const looked = new Set(), look = (p) => {
      if (looked.has(p) || p.lo > hi || p.hi < lo) return;
      looked.add(p);
      const arc = facing(p, it);
      if (arc) arcs.push(arc);
      if (p.line) for (const id of p.own) if (id !== it.id) look(lines.box.get(id));
      if (!arc) p.behind?.forEach(look);
    };
    met.forEach(look);
    if (it.line && it.own.length) it.behind = [...met];
    const left = from < to && seen[from].lo < it.lo ? [{ lo: seen[from].lo, hi: it.lo, it: seen[from].it }] : [], right = from < to && seen[to - 1].hi > it.hi ? [{ lo: it.hi, hi: seen[to - 1].hi, it: seen[to - 1].it }] : [];
    seen.splice(from, to - from, ...left, { lo: it.lo, hi: it.hi, it }, ...right);
  }
  let at;
  if (still) {
    // A stretch stays with a box that does not move: only what lands on what moved goes with it.
    const held = new Set(boxes.flatMap((b) => [b.low, b.high]));
    for (const s of stretches) if (!s.line.free || s.own.some((id) => !s.line.free.has(id))) held.add(s.n);
    at = within(places, held, arcs, told);
  } else {
    at = freely(places, arcs, boxes, told);
    for (const b of boxes) {
      const [low, high] = [at[b.low], at[b.high]];
      b.at[axis] = (low + high) / 2;
      b.size[axis] = high - low;
    }
  }
  for (const s of stretches) {
    const p = s.line.points;
    p[s.i - 1][axis] = at[s.n];
    p[s.i][axis] = at[s.n];
  }
  // An end that comes across the box's side, not onto it, stands on that side.
  for (const line of lines) {
    if (still && !line.free) continue;
    const p = line.points;
    for (const [end_, next, id, across] of [[p[0], p[1], line.a, line.across[0]], [p.at(-1), p.at(-2), line.b, line.across[1]]]) {
      if (!next || !across) continue;
      const b = lines.box.get(id);
      end_[axis] = b.at[axis] + Math.sign(next[axis] - b.at[axis]) * b.size[axis] / 2;
    }
  }
}

/** A line with a bend put in any stretch that runs along neither axis: every wire turns at right angles. */
function bent(points) {
  return points.flatMap((p, i) => (i && p[0] !== points[i - 1][0] && p[1] !== points[i - 1][1] ? [[points[i - 1][0], p[1]], p] : [p]));
}

/** A line as a list of its own, each stretch exactly along an axis: what is worked out from sums can be out by less than `TOUCH`, and would run along neither. */
function squared(points) {
  const out = points.map((c) => [...c]);
  for (let i = 1; i < out.length; i++) for (const axis of [0, 1]) if (Math.abs(out[i][axis] - out[i - 1][axis]) < TOUCH) out[i][axis] = out[i - 1][axis];
  return out;
}

/** Every box and line placed, `rounds` passes each way. `routes` by link, `nodes` by item, with `x` and `y` their middles, are changed in place. */
export function solve({ nodes, x, y, routes, wire, room, run, corner, apart, join, rounds = 2 }) {
  const boxes = [...x.keys()].map((id) => ({ id, at: [x.get(id), y.get(id)], size: [nodes.get(id).w, nodes.get(id).h], named: [nodes.get(id).w, nodes.get(id).h] }));
  const lines = [...routes].map(([k, r]) => { const [p, q] = k.split('|'); return { route: r, a: r.from, b: r.from === p ? q : p, points: squared(r.points) }; }).filter((l) => l.points.length > 1);
  lines.box = new Map(boxes.map((b) => [b.id, b]));
  lines.joined = new Set(routes.keys());
  const told = { freed: 0, rings: 0 };
  for (let round = 0; round < rounds; round++) for (const axis of [0, 1]) pass(axis, { lines, boxes, wire, room, run, corner, apart, join, told });
  const margin = Math.min(...boxes.map((b) => b.at[0] - b.size[0] / 2), ...lines.flatMap((l) => l.points.map((c) => c[0]))), top = Math.min(...boxes.map((b) => b.at[1] - b.size[1] / 2), ...lines.flatMap((l) => l.points.map((c) => c[1])));
  for (const b of boxes) {
    x.set(b.id, b.at[0] - margin + apart);
    y.set(b.id, b.at[1] - top + apart);
    nodes.get(b.id).w = b.size[0];
    nodes.get(b.id).h = b.size[1];
  }
  // A wire whose boxes now touch is one point: it stays a line of two, as every line is.
  for (const l of lines) l.route.points = bent(l.points.length > 1 ? l.points : [l.points[0], l.points[0]]).map(([p, q]) => [p - margin + apart, q - top + apart]);
  return told;
}

/**
 * Wires set again round what stands: every box stays, every line stays but those with `free`, the items that moved, and of
 * those what lands on anything else stays too. `boxes` are { id, at, size, named } and `lines` { a, b, points, free }, whose
 * points are changed. Says how many distances could not be kept.
 */
export function settle({ boxes, lines, wire, room, run, corner, apart, rounds = 2 }) {
  const told = { freed: 0, squeezed: 0, rings: 0 };
  lines.box = new Map(boxes.map((b) => [b.id, b]));
  for (let round = 0; round < rounds; round++) for (const axis of [0, 1]) pass(axis, { lines, boxes, wire, room, run, corner, apart, told, still: true });
  return told;
}

/** What is joined, by links: each a list of items. */
function sectionsOf(ids, routes) {
  const root = new Map(ids.map((id) => [id, id])), find = (id) => (root.get(id) === id ? id : (root.set(id, find(root.get(id))), root.get(id)));
  for (const k of routes.keys()) {
    const [p, q] = k.split('|');
    if (root.has(p) && root.has(q)) root.set(find(p), find(q));
  }
  const sets = new Map();
  for (const id of ids) (sets.get(find(id)) ?? sets.set(find(id), []).get(find(id))).push(id);
  return [...sets.values()];
}

/** What a set of boxes and lines takes up. */
function extent(ids, lines, x, y, nodes) {
  const xs = [...ids.flatMap((id) => [x.get(id) - nodes.get(id).w / 2, x.get(id) + nodes.get(id).w / 2]), ...lines.flatMap((l) => l.points.map((p) => p[0]))];
  const ys = [...ids.flatMap((id) => [y.get(id) - nodes.get(id).h / 2, y.get(id) + nodes.get(id).h / 2]), ...lines.flatMap((l) => l.points.map((p) => p[1]))];
  const [l, t] = [Math.min(...xs), Math.min(...ys)];
  return { ids, lines, l, t, w: Math.max(...xs) - l, h: Math.max(...ys) - t };
}

/**
 * Each joined section solved alone, then set out a `section` apart, so what is not joined does not look it. Items joined to
 * nothing stand together, `gap` apart, as one section. Sets out as wide as `aspect` asks, from `margin`.
 */
export function solveSections({ nodes, x, y, routes, section, gap, margin, aspect, ...lengths }) {
  const told = { freed: 0, rings: 0 }, whole = [], loose = [];
  for (const ids of sectionsOf([...x.keys()], routes)) {
    if (ids.length < 2) { loose.push(extent(ids, [], x, y, nodes)); continue; }
    const own = new Set(ids), lines = new Map([...routes].filter(([k]) => own.has(k.split('|')[0]))), at = (m) => new Map(ids.map((id) => [id, m.get(id)])), [lx, ly] = [at(x), at(y)];
    const one = solve({ nodes, x: lx, y: ly, routes: lines, ...lengths });
    (told.freed += one.freed), (told.rings += one.rings);
    for (const id of ids) (x.set(id, lx.get(id)), y.set(id, ly.get(id)));
    whole.push(extent(ids, [...lines.values()], x, y, nodes));
  }
  const move = (c, dx, dy) => {
    for (const id of c.ids) (x.set(id, x.get(id) + dx), y.set(id, y.get(id) + dy));
    for (const l of c.lines) l.points = l.points.map(([p, q]) => [p + dx, q + dy]);
  };
  const bySize = (p, q) => q.h - p.h || q.w - p.w;
  if (loose.length) {
    shelve(loose.sort(bySize), { gap, margin: 0, aspect }, move);
    whole.push(extent(loose.flatMap((c) => c.ids), [], x, y, nodes));
  }
  shelve(whole.sort(bySize), { gap: section, margin, aspect }, move);
  return told;
}
