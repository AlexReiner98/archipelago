// Each wire's way chosen before the solve: the simplest the topology allows, reading the first wires as a sketch of who
// stands beside whom. Straight between boxes that face each other, one bend from a side that faces where it goes, two through
// the gap between, and a wire that has to thread what stands in its way loses every step it can. Crossing less comes first, a
// side kept from holding more ends than it has room for next, then bends, then length. Nothing here is kept: the solve sets
// every place. Layer: shape. Pure: boxes and lines in, each line's points changed in place.

import { tidy } from './polyline.js';

const lengthOf = (l) => l.reduce((sum, p, i) => sum + (i ? Math.abs(p[0] - l[i - 1][0]) + Math.abs(p[1] - l[i - 1][1]) : 0), 0);
const spread = (lo, hi, n) => (hi < lo ? [] : n === 1 || hi === lo ? [(lo + hi) / 2] : [(lo + hi) / 2, ...Array.from({ length: n }, (_, k) => lo + ((hi - lo) * k) / (n - 1))]);

/** The places a port may stand along a box on axis `ax`: a pointed box has only its middle. */
const portsOf = (b, ax, pad, n) => (b.pointed ? [b.mid[ax]] : spread(b.lo[ax] + Math.min(pad, (b.hi[ax] - b.lo[ax]) / 3), b.hi[ax] - Math.min(pad, (b.hi[ax] - b.lo[ax]) / 3), n));

/** Every way from `a` to `b` of up to two bends that runs toward `b` the whole way. */
function ways(a, b, { corner, run, ports }) {
  const out = [];
  for (const [across, along] of [[0, 1], [1, 0]]) {
    const at = (u, v) => { const p = []; p[across] = u; p[along] = v; return p; };
    const sign = b.mid[along] >= a.mid[along] ? 1 : -1, from = sign > 0 ? a.hi[along] : a.lo[along], to = sign > 0 ? b.lo[along] : b.hi[along];
    if ((to - from) * sign > 0) {
      // However little two boxes overlap, the wire can drop straight between them.
      const inset = (box) => Math.min(corner, (box.hi[across] - box.lo[across]) / 3), lo = Math.max(a.lo[across] + inset(a), b.lo[across] + inset(b)), hi = Math.min(a.hi[across] - inset(a), b.hi[across] - inset(b));
      if (a.pointed || b.pointed) for (const u of [a.mid[across], b.mid[across]]) { if (u >= lo && u <= hi) out.push([at(u, from), at(u, to)]); }
      else for (const u of spread(lo, hi, ports)) out.push([at(u, from), at(u, to)]);
      if ((to - from) * sign >= run * 2) {
        const mids = spread(Math.min(from + sign * run, to - sign * run), Math.max(from + sign * run, to - sign * run), ports);
        for (const u of portsOf(a, across, corner, ports)) for (const v of portsOf(b, across, corner, ports)) if (u !== v) for (const m of mids) out.push([at(u, from), at(u, m), at(v, m), at(v, to)]);
      }
    }
    // One bend: out of `a` along `along`, into `b` by the side that faces it.
    const way = b.mid[across] >= a.mid[across] ? 1 : -1, into = way > 0 ? b.lo[across] : b.hi[across];
    for (const u of portsOf(a, across, corner, ports)) if ((into - u) * way >= run) for (const v of portsOf(b, along, corner, ports)) if ((v - from) * sign >= run) out.push([at(u, from), at(u, v), at(into, v)]);
  }
  return out;
}

/** The ways `line` can lose two bends, one run brought level with the next that goes the same way; a run that lands stays on its box. */
function shorn(line, a, b) {
  const out = [];
  for (let i = 1; i + 2 < line.length; i++) {
    const [p, q, r, s] = [line[i - 1], line[i], line[i + 1], line[i + 2]], ax = q[0] === r[0] ? 1 : 0, off = 1 - ax;
    if (Math.sign(q[off] - p[off]) !== Math.sign(s[off] - r[off])) continue;
    for (const [move, to, box] of [[[i - 1, i], r[ax], i === 1 && a], [[i + 1, i + 2], q[ax], i + 3 === line.length && b]]) {
      if (box && (box.pointed || to < box.lo[ax] + 1 || to > box.hi[ax] - 1)) continue;
      const next = line.map((c) => [...c]);
      for (const k of move) next[k][ax] = to;
      out.push(next);
    }
  }
  return out;
}

/**
 * Where two lines meet, in the sketch: `crossed` where they pass, or one stops on the other, which the solve can only turn into
 * a crossing, and `along` where they lie on one another. Lines that come to one port meet nowhere by that.
 */
function meeting(a, b) {
  let crossed = 0, along = 0;
  const ends = (p) => (p[0] === a[0][0] && p[1] === a[0][1]) || (p[0] === a.at(-1)[0] && p[1] === a.at(-1)[1]);
  const theirs = (p) => (p[0] === b[0][0] && p[1] === b[0][1]) || (p[0] === b.at(-1)[0] && p[1] === b.at(-1)[1]);
  for (let i = 1; i < a.length; i++) {
    const [p, q] = [a[i - 1], a[i]], ax = p[0] === q[0] ? 0 : 1, [plo, phi] = p[1 - ax] < q[1 - ax] ? [p[1 - ax], q[1 - ax]] : [q[1 - ax], p[1 - ax]];
    for (let j = 1; j < b.length; j++) {
      const [r, s] = [b[j - 1], b[j]], bx = r[0] === s[0] ? 0 : 1, [rlo, rhi] = r[1 - bx] < s[1 - bx] ? [r[1 - bx], s[1 - bx]] : [s[1 - bx], r[1 - bx]];
      if (ax === bx) {
        if (p[ax] === r[ax] && Math.min(phi, rhi) > Math.max(plo, rlo)) along++;
      } else if (p[ax] >= rlo && p[ax] <= rhi && r[bx] >= plo && r[bx] <= phi) {
        const at = ax === 0 ? [p[0], r[1]] : [r[0], p[1]];
        if (!(ends(at) && theirs(at))) crossed++;
      }
    }
  }
  return { crossed, along };
}

/** Which side of its box a line's end stands on, as `${id} ${axis the side lies along} ${which way it faces}`. */
const sideOf = (id, p, q) => { const ax = p[0] === q[0] ? 0 : 1; return `${id} ${ax} ${Math.sign(q[1 - ax] - p[1 - ax])}`; };

/** How many ends a side has room for, a `wire` apart inside its corners. */
const roomOn = (b, side, wire, corner) => {
  const ax = Number(side.split(' ')[1]), long = b.hi[ax] - b.lo[ax];
  return b.pointed ? 1 : 1 + Math.floor(Math.max(0, long - 2 * Math.min(corner, long / 3)) / wire);
};

/**
 * `boxes` by id are { x, y, w, h, pointed }, `wires` { a, b, points }, those with `kept` not looked at. `room` is what a wire
 * keeps from a box it passes, `run` from a port to its first corner, `corner` from a box's corner, `wire` from a wire beside it;
 * `ports` how many places along a side are tried, `rounds` how many times the wires are gone over, and the costs what a
 * crossing, a bend and an end too many on a side are worth in length.
 */
export function shape(boxes, wires, { room, run, corner, wire, ports, rounds, cost_cross, cost_bend, cost_side }) {
  const rects = new Map([...boxes].map(([id, b]) => [id, { id, lo: [b.x - b.w / 2, b.y - b.h / 2], hi: [b.x + b.w / 2, b.y + b.h / 2], mid: [b.x, b.y], pointed: b.pointed }]));
  const CELL = Math.max(1, ...[...rects.values()].map((b) => b.hi[0] - b.lo[0])), columns = new Map(), lines = wires.filter((w) => w.points.length > 1).map((w) => Object.assign(w, { points: tidy(w.points) }));
  for (const r of rects.values()) for (let c = Math.floor(r.lo[0] / CELL); c <= Math.floor(r.hi[0] / CELL); c++) (columns.get(c) ?? columns.set(c, []).get(c)).push(r);
  /** What stands across a span, by columns of the sketch, so a stretch is only tried against what is near. */
  const near = (lo, hi) => {
    const found = new Set();
    for (let c = Math.floor(lo / CELL); c <= Math.floor(hi / CELL); c++) for (const r of columns.get(c) ?? []) found.add(r);
    return found;
  };
  const load = new Map(), ends = (w) => [sideOf(w.a, w.points[0], w.points[1]), sideOf(w.b, w.points.at(-1), w.points.at(-2))];
  const bump = (w, by) => { for (const s of ends(w)) load.set(s, (load.get(s) ?? 0) + by); };
  /** Each cell of the sketch a line passes, so a line is only tried against those near it. */
  const cells = new Map(), cellsOf = (l) => {
    const out = new Set();
    for (let i = 1; i < l.length; i++) for (let c = Math.floor(Math.min(l[i - 1][0], l[i][0]) / CELL); c <= Math.floor(Math.max(l[i - 1][0], l[i][0]) / CELL); c++) for (let r = Math.floor(Math.min(l[i - 1][1], l[i][1]) / CELL); r <= Math.floor(Math.max(l[i - 1][1], l[i][1]) / CELL); r++) out.add(`${c} ${r}`);
    return out;
  };
  const file = (w, by) => { for (const c of cellsOf(w.points)) { if (by > 0) (cells.get(c) ?? cells.set(c, new Set()).get(c)).add(w); else cells.get(c).delete(w); } };
  const beside = (l) => { const found = new Set(); for (const c of cellsOf(l)) for (const v of cells.get(c) ?? []) found.add(v); return found; };
  lines.forEach((w) => (bump(w, 1), file(w, 1)));
  /** Whether each stretch keeps off every box; the stretch that lands on one leaves it at once. */
  const clear = (l, w, keep = room) => {
    for (let i = 1; i < l.length; i++) {
      const [p, q] = [l[i - 1], l[i]], left = Math.min(p[0], q[0]), right = Math.max(p[0], q[0]), top = Math.min(p[1], q[1]), low = Math.max(p[1], q[1]);
      for (const s of near(left - keep, right + keep)) {
        const off = (s.id === w.a && i === 1) || (s.id === w.b && i === l.length - 1) ? -1 : keep;
        if (right > s.lo[0] - off && left < s.hi[0] + off && low > s.lo[1] - off && top < s.hi[1] + off) return false;
      }
    }
    return !pierced(w.a, l[0], l[1], w) && !pierced(w.b, l.at(-1), l.at(-2), w);
  };
  /** Whether a line landing on the side of box `id` would meet one that runs through it: the solve could order neither. */
  const pierced = (id, p, q, w) => {
    if (p[1] !== q[1]) return false;
    const r = rects.get(id);
    for (const v of beside([r.lo, r.hi])) {
      if (v === w || v.a === id || v.b === id) continue;
      for (let i = 1; i < v.points.length; i++) {
        const [c, d] = [v.points[i - 1], v.points[i]];
        if (c[1] === d[1] && c[1] > r.lo[1] && c[1] < r.hi[1] && Math.max(c[0], d[0]) > r.lo[0] && Math.min(c[0], d[0]) < r.hi[0]) return true;
      }
    }
    return false;
  };
  /** The ways `l` can get out of a box a stretch of it runs through: that stretch moved past either edge. */
  const aside = (l, w) => {
    const out = [];
    for (let i = 2; i < l.length - 1; i++) {
      const [p, q] = [l[i - 1], l[i]], ax = p[0] === q[0] ? 0 : 1, left = Math.min(p[0], q[0]), right = Math.max(p[0], q[0]), top = Math.min(p[1], q[1]), low = Math.max(p[1], q[1]);
      for (const r of near(left, right)) {
        if (right <= r.lo[0] || left >= r.hi[0] || low <= r.lo[1] || top >= r.hi[1]) continue;
        for (const to of [r.lo[ax] - room - wire, r.hi[ax] + room + wire]) out.push(l.map((c, k) => { const n = [...c]; if (k === i - 1 || k === i) n[ax] = to; return n; }));
      }
    }
    return out;
  };
  /** The ways a line that meets others can step past them: a stretch of it moved to just beyond each wire that runs beside it. */
  const past = (l, w) => {
    const out = [], a = rects.get(w.a), b = rects.get(w.b);
    for (let i = 1; i < l.length; i++) {
      const [p, q] = [l[i - 1], l[i]], ax = p[0] === q[0] ? 0 : 1, box = i === 1 ? a : i === l.length - 1 ? b : null, tos = new Set();
      for (const v of beside(l)) if (v !== w) for (let j = 1; j < v.points.length; j++) if (v.points[j - 1][ax] === v.points[j][ax]) for (const by of [-wire, wire]) tos.add(v.points[j][ax] + by);
      for (const to of tos) {
        if (box && (box.pointed || to < box.lo[ax] + corner || to > box.hi[ax] - corner)) continue;
        out.push(l.map((c, k) => { const n = [...c]; if (k === i - 1 || k === i) n[ax] = to; return n; }));
      }
    }
    return out;
  };
  /** What a line's meetings with the others cost: wires of one box may run together, for the solve to part. */
  const met = (l, w, most) => {
    let cost = 0;
    for (const v of beside(l)) {
      if (v === w) continue;
      const { crossed, along } = meeting(l, v.points);
      cost += crossed * cost_cross + along * (v.a === w.a || v.a === w.b || v.b === w.a || v.b === w.b ? cost_bend : cost_cross);
      if (cost >= most) return cost;
    }
    return cost;
  };
  const over = (l, w) => {
    let n = 0;
    for (const [id, p, q] of [[w.a, l[0], l[1]], [w.b, l.at(-1), l.at(-2)]]) {
      const s = sideOf(id, p, q);
      if ((load.get(s) ?? 0) >= roomOn(rects.get(id), s, wire, corner)) n++;
    }
    return n * cost_side;
  };
  const plain = (l) => (l.length - 2) * cost_bend + lengthOf(l);
  for (let round = 0; round < rounds; round++) {
    for (const w of [...lines].sort((p, q) => q.points.length - p.points.length || lengthOf(q.points) - lengthOf(p.points))) {
      if (w.kept) continue;
      const a = rects.get(w.a), b = rects.get(w.b);
      bump(w, -1);
      file(w, -1);
      const was = w.points, tried = [...shorn(was, a, b), ...shorn(was, a, b).flatMap((l) => shorn(tidy(l), a, b)), ...ways(a, b, { corner, run, ports })].map((l) => { const line = tidy(l); return { l: line, plain: plain(line) }; }).sort((p, q) => p.plain - q.plain);
      // A line through a box cannot stand: the solve cannot part what it does not see as apart.
      const standing = clear(was, w, 0), slid = standing ? [] : aside(was, w).map((l) => { const line = tidy(l); return { l: line, plain: plain(line) }; });
      const beyond = round < rounds - 1 || (standing && met(was, w, cost_cross) < cost_cross) ? [] : past(was, w).map((l) => { const line = tidy(l); return { l: line, plain: plain(line) }; });
      if (slid.length || beyond.length) tried.push(...slid, ...beyond), tried.sort((p, q) => p.plain - q.plain);
      let best = was, least = plain(was) + met(was, w, Infinity) + over(was, w) + (standing ? 0 : cost_cross * 2);
      for (const { l, plain: alone } of tried) {
        if (alone >= least) break;
        const cost = alone + over(l, w);
        if (cost >= least) continue;
        const all = cost + met(l, w, least - cost);
        if (all < least && clear(l, w)) ((least = all), (best = l));
      }
      w.points = best;
      bump(w, 1);
      file(w, 1);
    }
  }
}
