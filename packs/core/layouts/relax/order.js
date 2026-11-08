// The order the relaxation keeps (step 3, task e_7et8f4uv): on each axis, what stands beside what in the shape, read off
// it as the flow's solve (../flow/solve.js) reads a drawing, each pair a least distance by what the two are. A sweep
// along the axis finds what each thing sees on its low side; what stands behind that is kept off by the chain. So the
// relaxation can move every number and still never changes a side, a crossing or a bend. Layer: metrics. Pure.

import { TOUCH } from './atoms.js';

/** Everything that stands at a place on axis `a`, with its extent across: boxes, stretches across `a`, island sides. */
function things(read, a) {
  const b = 1 - a, c = ['x', 'y'], out = [];
  for (const n of read.nodes.values()) if (n.size[0] || n.size[1]) out.push({ key: `n:${n.id}`, kind: 'box', box: n, at: n[c[a]], lo: n[c[b]] - n.w / 2 * !b - n.h / 2 * b, hi: n[c[b]] + n.w / 2 * !b + n.h / 2 * b, half: n.size[a] / 2 });
  for (const w of read.wires) w.points.forEach((q, k) => {
    const o = w.points[k - 1];
    if (!k || o[a] !== q[a]) return;
    const own = [k === 1 && w.ends[0], k === w.points.length - 1 && w.ends[1]].filter(Boolean);
    out.push({ key: `w:${w.id}:${k}`, kind: 'wire', wire: w, own, at: q[a], lo: Math.min(o[b], q[b]), hi: Math.max(o[b], q[b]), half: 0 });
  });
  for (const i of read.islands.values()) for (const hi of [0, 1]) out.push({ key: `i:${i.id}:${hi}`, kind: hi ? 'hi' : 'lo', island: i, at: i.rect[a + 2 * hi], lo: i.rect[b], hi: i.rect[b + 2], half: 0 });
  return out;
}

/**
 * The least distance from `p` to `q`, `p` on the low side, by what the two are; null where none is kept (a wire's end and
 * its own box, kept by its range). `z` holds the distances: `apart` (two boxes), `wire` (two wires), `room` (a wire and
 * a box it passes), `run` (a wire and a box it goes to), `pad` (inside an island's side), `head` (an island's name over
 * what it holds, by island), `sea` (two islands), `shore` (a box and an island it is not on).
 */
function distance(p, q, a, z) {
  if (p.kind === 'lo' || q.kind === 'hi') {
    const side = p.kind === 'lo' ? p : q, other = side === p ? q : p;
    if (other.kind === 'lo' || other.kind === 'hi') return other.island === side.island ? 2 * z.pad : z.sea;
    return z.pad + (a === 1 && side.kind === 'lo' ? z.head(side.island.id) : 0);
  }
  if (p.kind === 'hi' || q.kind === 'lo') {
    const other = p.kind === 'hi' ? q : p;
    return other.kind === 'hi' || other.kind === 'lo' ? z.sea : other.kind === 'box' ? z.shore : z.room;
  }
  if (p.kind === 'box' && q.kind === 'box') return z.apart;
  if (p.kind === 'wire' && q.kind === 'wire') return z.wire;
  const [s, box] = p.kind === 'wire' ? [p, q.box] : [q, p.box];
  if (s.own.includes(box)) return null;
  return s.wire.ends.includes(box) ? z.run : z.room;
}

/** Arcs [from, to, length] between roots: the number `to` stands at least `length` past `from`. */
function arc(ax, p, q, length) {
  const [rp, op] = ax.find(p.key), [rq, oq] = ax.find(q.key);
  return rp === rq ? null : [rp, rq, op + p.half + length + q.half - oq];
}

/**
 * Every least distance on axis `a`: `order` (each pair that sees one another, in the shape's order) and `bounds` (a
 * wire's end inside its box's corners, a port inside its island's side). Each is [from root, to root, length].
 */
export function orderOn(read, a, z) {
  const ax = read.axes[a], order = [], bounds = [];
  const placed = things(read, a).sort((p, q) => p.at - q.at || (p.kind === 'hi') - (q.kind === 'hi') || (q.kind === 'lo') - (p.kind === 'lo'));
  // What is seen across: spans of the other axis, each with the last thing that stood there.
  let seen = [];
  for (const it of placed) {
    const [lo, hi] = [it.lo - TOUCH, it.hi + TOUCH], met = new Set(seen.filter((s) => s.hi >= lo && s.lo <= hi).map((s) => s.it));
    for (const p of met) {
      const d = p.at === it.at && p.kind === 'wire' && it.kind === 'wire' ? null : distance(p, it, a, z), e = d === null ? null : arc(ax, p, it, d);
      if (e) order.push(e);
    }
    const kept = [];
    for (const s of seen) {
      if (s.hi < it.lo || s.lo > it.hi) { kept.push(s); continue; }
      if (s.lo < it.lo) kept.push({ lo: s.lo, hi: it.lo, it: s.it });
      if (s.hi > it.hi) kept.push({ lo: it.hi, hi: s.hi, it: s.it });
    }
    kept.push({ lo: it.lo, hi: it.hi, it });
    seen = kept.sort((p, q) => p.lo - q.lo);
  }
  // Each stretch along the axis keeps its way and a least length: `run` off a box, so a wire leaves it before it turns,
  // twice that between two, and `wire` between two bends, so no bend is lost.
  for (const w of read.wires) w.points.forEach((q, k) => {
    const o = w.points[k - 1];
    if (!k || o[a] === q[a]) return;
    const off = [k === 1 && w.ends[0]?.size[a], k === w.points.length - 1 && w.ends[1]?.size[a]].filter(Boolean).length;
    const [lo, hi] = o[a] < q[a] ? [`w:${w.id}:${k - 1}`, `w:${w.id}:${k}`] : [`w:${w.id}:${k}`, `w:${w.id}:${k - 1}`];
    const [rl, ol] = ax.find(lo), [rh, oh] = ax.find(hi);
    if (rl !== rh) bounds.push([rl, rh, ol + (off ? off * z.run : z.wire) - oh]);
  });
  for (const r of ax.ranges) {
    const [rb, ob] = ax.find(r.box), [re, oe] = ax.find(r.end);
    if (rb === re) continue;
    bounds.push([rb, re, ob - r.half + r.inset - oe], [re, rb, oe - (ob + r.half - r.inset)]);
  }
  for (const p of read.ports) {
    const along = p.side === 'left' || p.side === 'right' ? 1 : 0;
    if (along !== a) continue;
    const [r0, o0] = ax.find(`i:${p.island}:0`), [r1, o1] = ax.find(`i:${p.island}:1`), [rp, op] = ax.find(`n:${p.id}`);
    if (r0 !== rp) bounds.push([r0, rp, o0 + z.pad - op]);
    if (r1 !== rp) bounds.push([rp, r1, op + z.pad - o1]);
  }
  return { order, bounds };
}
