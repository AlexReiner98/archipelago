// The order the relaxation keeps (step 3, task e_7et8f4uv): on each axis, what stands beside what in the shape, read off
// it as the flow's solve (../flow/solve.js) reads a drawing, each pair a least distance by what the two are. A sweep
// along the axis finds what each thing sees on its low side; what stands behind that is kept off by the chain. So the
// relaxation can move every number and still never changes a side, a crossing or a bend. Layer: metrics. Pure.

import { isBox, TOUCH } from './atoms.js';

/** Everything that stands at a place on axis `a`, with its extent across: boxes, stretches across `a`, island sides. */
function things(read, a) {
  const b = 1 - a, c = ['x', 'y'], out = [];
  const half = (n, ax) => (ax ? n.h : n.w) / 2;
  // A box stands at its low side: the stretches that land on it stand inside it, after it, and so never hide it.
  for (const n of read.nodes.values()) if (isBox(n)) out.push({ low: `b:${n.id}:0`, high: `b:${n.id}:1`, kind: 'box', box: n, at: n[c[a]] - half(n, a), lo: n[c[b]] - half(n, b), hi: n[c[b]] + half(n, b) });
  for (const w of read.wires) w.points.forEach((q, k) => {
    const o = w.points[k - 1];
    if (!k || o[a] !== q[a]) return;
    const own = [k === 1 && w.ends[0], k === w.points.length - 1 && w.ends[1]].filter(Boolean);
    out.push({ low: `w:${w.id}:${k}`, high: `w:${w.id}:${k}`, kind: 'wire', wire: w, own, at: q[a], lo: Math.min(o[b], q[b]), hi: Math.max(o[b], q[b]) });
  });
  for (const i of read.islands.values()) for (const hi of [0, 1]) out.push({ low: `i:${i.id}:${hi}`, high: `i:${i.id}:${hi}`, kind: hi ? 'hi' : 'lo', island: i, at: i.rect[a + 2 * hi], lo: i.rect[b], hi: i.rect[b + 2] });
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

/** An arc [from, to, length] between roots: the key `to` stands at least `length` past the key `from`; null if one number. */
function arc(ax, from, to, length) {
  const [rp, op] = ax.find(from), [rq, oq] = ax.find(to);
  return rp === rq ? null : [rp, rq, op + length - oq];
}

/**
 * Every least distance on axis `a`: `order` (each pair that sees one another, in the shape's order) and `bounds` (a
 * box at least its size, a wire's end inside its box's corners, a port inside its island's side), and `caps` (a box at most its size). Each is [from root,
 * to root, length].
 */
export function orderOn(read, a, z) {
  const ax = read.axes[a], order = [], bounds = [];
  const placed = things(read, a).sort((p, q) => p.at - q.at || (p.kind === 'hi') - (q.kind === 'hi') || (q.kind === 'lo') - (p.kind === 'lo'));
  // What is seen across: spans of the other axis, each with the last thing that stood there.
  let seen = [];
  for (const it of placed) {
    const [lo, hi] = [it.lo - TOUCH, it.hi + TOUCH], met = new Set(seen.filter((s) => s.hi >= lo && s.lo <= hi).map((s) => s.it));
    for (const p of met) {
      const d = p.at === it.at && p.kind === 'wire' && it.kind === 'wire' ? null : distance(p, it, a, z), e = d === null ? null : arc(ax, p.high, it.low, d);
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
  const bound = (from, to, length) => { const e = arc(ax, from, to, length); if (e) bounds.push(e); };
  for (const w of read.wires) w.points.forEach((q, k) => {
    const o = w.points[k - 1];
    if (!k || o[a] === q[a]) return;
    const off = [k === 1 && isBox(w.ends[0]), k === w.points.length - 1 && isBox(w.ends[1])].filter(Boolean).length;
    const [lo, hi] = o[a] < q[a] ? [`w:${w.id}:${k - 1}`, `w:${w.id}:${k}`] : [`w:${w.id}:${k}`, `w:${w.id}:${k - 1}`];
    bound(lo, hi, off ? off * z.run : z.wire);
  });
  // A box is as long as its words and the ends on its sides need (atoms.js's `grown`), and no longer: the cap, let go of
  // only where the order cannot be kept inside it. A wire that does not line up takes its slack in its own stretches.
  const caps = [];
  for (const n of read.nodes.values()) if (isBox(n)) {
    bound(`b:${n.id}:0`, `b:${n.id}:1`, n.size[a]);
    const e = arc(ax, `b:${n.id}:1`, `b:${n.id}:0`, -n.size[a]);
    if (e) caps.push(e);
  }
  for (const r of ax.ranges) (bound(r.lo, r.end, r.inset), bound(r.end, r.hi, r.inset));
  for (const p of read.ports) {
    if (!p.on || (p.side === 'left' || p.side === 'right' ? 1 : 0) !== a) continue;
    (bound(`i:${p.island}:0`, `n:${p.id}`, z.pad), bound(`n:${p.id}`, `i:${p.island}:1`, z.pad));
  }
  return { order, bounds, caps };
}
