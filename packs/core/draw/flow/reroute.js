// The ways a wire may go between two boxes of up to two bends, and the best of them for a wire with no old way to keep to.
// It serves a step put by hand, until the solve does. Pure: boxes and lines in, lines changed in place.

import { count, touch } from './count.js';
import { tidy } from './polyline.js';

const lengthOf = (l) => l.reduce((sum, p, i) => sum + (i ? Math.abs(p[0] - l[i - 1][0]) + Math.abs(p[1] - l[i - 1][1]) : 0), 0);
const spread = (lo, hi, n) => (hi < lo ? [] : n === 1 || hi === lo ? [(lo + hi) / 2] : [(lo + hi) / 2, ...Array.from({ length: n }, (_, k) => lo + ((hi - lo) * k) / (n - 1))]);
const boundsOf = (l) => [Math.min(...l.map((p) => p[0])), Math.max(...l.map((p) => p[0])), Math.min(...l.map((p) => p[1])), Math.max(...l.map((p) => p[1]))];

/** The places a port may stand along each side of a box: `ax` 0 for those along its top and foot, 1 for those down its sides. */
const portsOf = (b, ax, pad, n) => (b.pointed ? [b.mid[ax]] : spread(b.lo[ax] + Math.min(pad, (b.hi[ax] - b.lo[ax]) / 3), b.hi[ax] - Math.min(pad, (b.hi[ax] - b.lo[ax]) / 3), n));

/** Every way from `a` to `b` of up to two bends that runs toward `b` the whole way, by side. */
function ways(a, b, pad, was, run, n) {
  const out = [];
  for (const [across, along] of [[0, 1], [1, 0]]) {
    // Wires that run along axis `along`, leaving `a` at a place `across`.
    const sign = b.mid[along] >= a.mid[along] ? 1 : -1, from = sign > 0 ? a.hi[along] : a.lo[along], to = sign > 0 ? b.lo[along] : b.hi[along];
    const at = (u, v) => { const p = []; p[across] = u; p[along] = v; return p; };
    const blocked = (box, s) => along === 0 && s > 0 && box.noRight;
    if ((to - from) * sign > 0 && !blocked(a, sign) && !blocked(b, -sign)) {
      const mine = portsOf(a, across, pad, n), yours = portsOf(b, across, pad, n);
      for (const u of mine.filter((u) => u >= b.lo[across] + 1 && u <= b.hi[across] - 1)) out.push([at(u, from), at(u, to)]);
      for (const u of yours.filter((u) => u >= a.lo[across] + 1 && u <= a.hi[across] - 1)) out.push([at(u, from), at(u, to)]);
      // However little two boxes overlap, the wire can drop straight between them.
      const inset = (box) => Math.min(pad, (box.hi[across] - box.lo[across]) / 3), over = [Math.max(a.lo[across] + inset(a), b.lo[across] + inset(b)), Math.min(a.hi[across] - inset(a), b.hi[across] - inset(b))];
      if (!a.pointed && !b.pointed) for (const u of spread(over[0], over[1], n)) out.push([at(u, from), at(u, to)]);
      const mids = [(from + to) / 2, from + sign * run, to - sign * run, ...was.map((p) => p[along]).filter((v) => (v - from) * sign >= run && (to - v) * sign >= run)];
      for (const u of mine) for (const v of yours) if (u !== v) for (const m of mids) out.push([at(u, from), at(u, m), at(v, m), at(v, to)]);
    }
    // One bend: out of `a` along `along`, into `b` from the side.
    const other = 1 - along, way = b.mid[other] >= a.mid[other] ? 1 : -1, into = way > 0 ? b.lo[other] : b.hi[other];
    if ((b.lo[along] - from) * sign < 0 && (b.hi[along] - from) * sign < 0) continue;
    if (blocked(a, sign) || blocked(b, -way) && other === 0) continue;
    for (const u of portsOf(a, across, pad, n)) if ((into - u) * way >= run) for (const v of portsOf(b, along, pad, n)) if ((v - from) * sign >= run) out.push([at(u, from), at(u, v), at(into, v)]);
  }
  return out;
}

/** Each stretch of `line` clear of the solid parts, and nothing crossed or touched that was not. */
export function clear(line, was, w, solids, others, room, gap, mates = null) {
  const [l, r, t, u] = boundsOf(line);
  for (let i = 1; i < line.length; i++) {
    const [p, q] = [line[i - 1], line[i]], lo = Math.min(p[0], q[0]), hi = Math.max(p[0], q[0]), top = Math.min(p[1], q[1]), low = Math.max(p[1], q[1]);
    for (const s of solids.near(lo - room, hi + room)) {
      // The stretch that lands on a box leaves it at once: only what it passes must be kept off.
      // One straight stretch between two facing boxes is as clear as they are of what stands beside.
      const off = (s.id === w.a && i === 1) || (s.id === w.b && i === line.length - 1) ? -1 : line.length === 2 ? 2 : room;
      if (hi > s.l - off && lo < s.r + off && low > s.t - off && top < s.u + off) return false;
    }
  }
  for (const v of others) {
    if (v === w) continue;
    const [vl, vr, vt, vu] = v.bounds ?? (v.bounds = boundsOf(v.points));
    if (vr < l || vl > r || vu < t || vt > u) continue;
    if (count([line, v.points]).crossings > count([was, v.points]).crossings) return false;
    if (mates?.has(v)) continue;
    if (touch(line, v.points) && !touch(was, v.points)) return false;
    if (gap && beside(line, v.points, gap) > beside(was, v.points, gap)) return false;
  }
  return true;
}

/** How many stretches of two lines run side by side nearer than `gap`. */
function beside(a, b, gap) {
  let n = 0;
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const [p, q, r, s] = [a[i - 1], a[i], b[j - 1], b[j]], ax = p[0] === q[0] ? 0 : p[1] === q[1] ? 1 : -1;
    if (ax < 0 || r[ax] !== s[ax] || Math.abs(p[ax] - r[ax]) >= gap) continue;
    const o = 1 - ax;
    if (Math.min(Math.max(p[o], q[o]), Math.max(r[o], s[o])) - Math.max(Math.min(p[o], q[o]), Math.min(r[o], s[o])) > 1) n++;
  }
  return n;
}

/** Each box's own shape by id, and in `solids` what a wire keeps off, a box and, apart from it, what hangs beside it. */
export function shapesOf(boxes, track) {
  const shape = new Map(), solids = [];
  for (const [id, b] of boxes) {
    const [[l, r], [t, u]] = b.reach ?? [[-b.size[0] / 2, b.size[0] / 2], [-b.size[1] / 2, b.size[1] / 2]], [x, y] = b.at;
    const noRight = r < b.size[0] / 2 - 1;
    shape.set(id, { lo: [x + l, y + t], hi: [x + r, y + u], mid: [x + (l + r) / 2, y + (t + u) / 2], noRight, pointed: b.pointed });
    solids.push({ id, l: x + l + 1, r: x + r - 1, t: y + t + 1, u: y + u - 1 });
    if (noRight) solids.push({ l: x + r + track, r: x + b.size[0] / 2, t: y - b.size[1] / 2, u: y + b.size[1] / 2 });
  }
  // What stands across a span of the picture, by columns of the picture, so a stretch is only tried against what is near.
  const CELL = Math.max(1, ...solids.map((s) => s.r - s.l)), columns = new Map();
  for (const s of solids) for (let c = Math.floor(s.l / CELL); c <= Math.floor(s.r / CELL); c++) (columns.get(c) ?? columns.set(c, []).get(c)).push(s);
  solids.near = (lo, hi) => {
    const found = new Set();
    for (let c = Math.floor(lo / CELL); c <= Math.floor(hi / CELL); c++) for (const s of columns.get(c) ?? []) found.add(s);
    return found;
  };
  shape.solids = solids;
  return shape;
}

/**
 * Give each wire the best way it has, where it has no old way to keep to: clear of every box, crossing least, then with the
 * fewest bends, then shortest. A wire with no such way keeps the line it came with, which goes round the boxes.
 */
export function rewire(boxes, wires, still, { track, room, run, corner, ports }) {
  const shape = shapesOf(boxes, track), { solids } = shape, others = [...wires, ...still.map((points) => ({ points }))];
  for (const w of wires) {
    const a = shape.get(w.a), b = shape.get(w.b), ways_ = ways(a, b, corner, [], run, ports).map((l) => tidy(l)).sort((p, q) => p.length - q.length || lengthOf(p) - lengthOf(q));
    let best = null, least = Infinity;
    for (const l of ways_) {
      if (l.length > (best?.length ?? Infinity) && !least) break;
      if (!clear(l, l, w, solids, [], room, 0)) continue;
      const crossed = others.reduce((sum, v) => sum + (v === w ? 0 : count([l, v.points]).crossings + (touch(l, v.points) ? 0.5 : 0)), 0);
      if (crossed < least) ((least = crossed), (best = l));
    }
    if (best) ((w.points = best), (w.bounds = null));
  }
}
