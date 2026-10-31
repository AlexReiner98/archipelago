// Every box edge and wire stretch placed by one solve, axis by axis: each is a number, and each pair that stands beside one
// another keeps a least distance, by what the two are. The distance is asked for, not kept as found, so wires too near are
// moved apart and no two wires share a line. Order on an axis is read off the drawing as given, so nothing crossed is undone
// and nothing new is crossed. Layer: metrics. Pure: places and lines in, changed in place.

import { tidy } from './polyline.js';

/** How far apart two things must be across, to count as beside one another. */
const TOUCH = 0.5;

/** How many times the arcs are gone over, at most: past it they ask for more than can be. */
const PASSES = 400;

/** The numbers in an order every arc runs forward in, with what leaves each; null where they go in a ring. */
function ordered(n, arcs) {
  const out = Array.from({ length: n }, () => []), degree = new Array(n).fill(0);
  for (const [p, q, l] of arcs) (out[p].push([q, l]), degree[q]++);
  const queue = [];
  for (let k = 0; k < n; k++) if (!degree[k]) queue.push(k);
  for (let k = 0; k < queue.length; k++) for (const [q] of out[queue[k]]) if (!--degree[q]) queue.push(q);
  return queue.length === n ? { queue, out } : null;
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
function pass(axis, { lines, boxes, wire, room, run, corner, apart, told }) {
  const other = 1 - axis, stretches = [], places = [];
  const number = (value) => (places.push(value), places.length - 1);
  for (const b of boxes) ((b.low = number(b.at[axis] - b.size[axis] / 2)), (b.high = number(b.at[axis] + b.size[axis] / 2)));
  for (const line of lines) {
    const p = (line.points = tidy(line.points));
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
  for (let i = 0; i < stretches.length; i++) for (let j = i + 1; j < stretches.length; j++) {
    const [p, q] = [stretches[i], stretches[j]];
    if (p.lo > q.hi + TOUCH || q.lo > p.hi + TOUCH) continue;
    arcs.push([p.n, q.n, p.line === q.line ? 0 : wire]);
  }
  for (const s of stretches) for (const b of boxes) {
    if (s.lo > b.at[other] + b.size[other] / 2 || s.hi < b.at[other] - b.size[other] / 2 || s.own.includes(b.id)) continue;
    const far = s.line.a === b.id || s.line.b === b.id ? run : room;
    arcs.push(s.at < b.at[axis] ? [s.n, b.low, far] : [b.high, s.n, far]);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [p, q] = boxes[i].at[axis] <= boxes[j].at[axis] ? [boxes[i], boxes[j]] : [boxes[j], boxes[i]];
    if (Math.abs(p.at[other] - q.at[other]) < (p.size[other] + q.size[other]) / 2 + TOUCH) arcs.push([p.high, q.low, apart]);
  }
  const order = ordered(places.length, arcs);
  if (!order) throw new Error('The solve went in a ring');
  // A box is as big as its name and what lands on it need, and no bigger: that much and it stands rigid, so what stands
  // beside its ports moves the box and never stretches it.
  const spot = [];
  order.queue.forEach((v, k) => (spot[v] = k));
  const rigid = new Map(boxes.map((b) => [b, [b.high, b.low, -reach(order, spot, b.low, b.high)]]));
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
  const end = Math.max(...first), last = least(places.length, all.map(([p, q, l]) => [q, p, l])).at.map((v) => end - v), at = first.map((v, k) => (v + last[k]) / 2);
  for (const b of boxes) {
    const [low, high] = [at[b.low], at[b.high]];
    b.at[axis] = (low + high) / 2;
    b.size[axis] = high - low;
  }
  for (const s of stretches) {
    const p = s.line.points;
    p[s.i - 1][axis] = at[s.n];
    p[s.i][axis] = at[s.n];
  }
  // An end that comes across the box's side, not onto it, stands on that side.
  for (const line of lines) {
    const p = line.points;
    for (const [end_, next, id] of [[p[0], p[1], line.a], [p.at(-1), p.at(-2), line.b]]) {
      if (!next || end_[axis] === next[axis]) continue;
      const b = lines.box.get(id);
      end_[axis] = b.at[axis] + Math.sign(next[axis] - b.at[axis]) * b.size[axis] / 2;
    }
  }
}

/** Every box and line placed, `rounds` passes each way. `routes` by link, `nodes` by item, with `x` and `y` their middles, are changed in place. */
export function solve({ nodes, x, y, routes, wire, room, run, corner, apart, rounds = 2 }) {
  const boxes = [...x.keys()].map((id) => ({ id, at: [x.get(id), y.get(id)], size: [nodes.get(id).w, nodes.get(id).h], named: [nodes.get(id).w, nodes.get(id).h] }));
  const lines = [...routes].map(([k, r]) => { const [p, q] = k.split('|'); return { route: r, a: r.from, b: r.from === p ? q : p, points: r.points.map((c) => [...c]) }; }).filter((l) => l.points.length > 1);
  lines.box = new Map(boxes.map((b) => [b.id, b]));
  const told = { freed: 0 };
  for (let round = 0; round < rounds; round++) for (const axis of [0, 1]) pass(axis, { lines, boxes, wire, room, run, corner, apart, told });
  const margin = Math.min(...boxes.map((b) => b.at[0] - b.size[0] / 2), ...lines.flatMap((l) => l.points.map((c) => c[0]))), top = Math.min(...boxes.map((b) => b.at[1] - b.size[1] / 2), ...lines.flatMap((l) => l.points.map((c) => c[1])));
  for (const b of boxes) {
    x.set(b.id, b.at[0] - margin + apart);
    y.set(b.id, b.at[1] - top + apart);
    nodes.get(b.id).w = b.size[0];
    nodes.get(b.id).h = b.size[1];
  }
  // A wire whose boxes now touch is one point: it stays a line of two, as every line is.
  for (const l of lines) l.route.points = (l.points.length > 1 ? l.points : [l.points[0], l.points[0]]).map(([p, q]) => [p - margin + apart, q - top + apart]);
  return told;
}
