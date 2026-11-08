// The order the relaxation keeps (step 3, task e_7et8f4uv): on each axis, what stands beside what in the shape, read off
// it as the flow's solve (../flow/solve.js) reads a drawing, each pair a least distance by what the two are. A sweep
// along the axis finds what each thing sees on its low side; what stands behind that is kept off by the chain. So the
// relaxation can move every number and still never changes a side, a crossing or a bend. Layer: metrics. Pure.

import { isBox, TOUCH } from './atoms.js';

/** Everything that stands at a place on axis `a`, with its extent across: boxes, stretches across `a`, stretches of shore. */
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
  out.push(...read.shores.things[a]);
  return out;
}

/**
 * The least distance from `p` to `q`, `p` on the low side, by what the two are; null where none is kept (a wire's end and
 * its own box, kept by its range). `z` holds the distances: `apart` (two boxes), `wire` (two wires), `room` (a wire and
 * a box it passes), `run` (a wire and a box it goes to), `pad` (inside an island's side), `head` (an island's name over
 * what it holds, by island), `sea` (two islands), `shore` (a box and an island it is not on).
 */
function distance(p, q, a, z) {
  // Two stretches of shore: of two islands the sea between; of one, two sides of a band or a bay across the sea; two
  // sides of one island facing alike (a band's and the next's) keep no order, so a step may turn either way.
  if (shore(p) && shore(q)) return p.island !== q.island ? z.sea : p.kind === q.kind ? null : 2 * z.pad;
  if (p.kind === 'lo' || q.kind === 'hi') {
    const side = p.kind === 'lo' ? p : q;
    return z.pad + (a === 1 && side.top ? z.head(side.island.id) : 0);
  }
  if (p.kind === 'hi' || q.kind === 'lo') return (p.kind === 'hi' ? q : p).kind === 'box' ? z.shore : z.room;
  if (p.kind === 'box' && q.kind === 'box') return z.apart;
  if (p.kind === 'wire' && q.kind === 'wire') return z.wire;
  const [s, box] = p.kind === 'wire' ? [p, q.box] : [q, p.box];
  if (s.own.includes(box)) return null;
  return s.wire.ends.includes(box) ? z.run : z.room;
}

/** Whether a thing is a stretch of an island's shore. */
const shore = (t) => t.kind === 'lo' || t.kind === 'hi';

/** An arc [from, to, length] between roots: the key `to` stands at least `length` past the key `from`; null if one number. */
function arc(ax, from, to, length) {
  const [rp, op] = ax.find(from), [rq, oq] = ax.find(to);
  return rp === rq ? null : [rp, rq, op + length - oq];
}

/** Each pair of `list` that sees one another along axis a, in order, low first: `meet(p, q)`. */
function sweep(list, meet) {
  const placed = [...list].sort((p, q) => p.at - q.at || (p.kind === 'hi') - (q.kind === 'hi') || (q.kind === 'lo') - (p.kind === 'lo'));
  // What is seen across: spans of the other axis, each with the last thing that stood there.
  let seen = [];
  for (const it of placed) {
    const [lo, hi] = [it.lo - TOUCH, it.hi + TOUCH], met = new Set(seen.filter((s) => s.hi >= lo && s.lo <= hi).map((s) => s.it));
    for (const p of met) meet(p, it);
    const kept = [];
    for (const s of seen) {
      if (s.hi < it.lo || s.lo > it.hi) { kept.push(s); continue; }
      if (s.lo < it.lo) kept.push({ lo: s.lo, hi: it.lo, it: s.it });
      if (s.hi > it.hi) kept.push({ lo: it.hi, hi: s.hi, it: s.it });
    }
    kept.push({ lo: it.lo, hi: it.hi, it });
    seen = kept.sort((p, q) => p.lo - q.lo);
  }
}

/**
 * Every least distance on axis `a`: `order` (each pair that sees one another, in the shape's order) and `bounds` (a
 * box at least its size, a wire's end inside its box's corners, a port inside its band's side, an island's bands in order), `caps` (a box at most its size), and `tight` (the order between a shore and what it holds, drawn in tight). Each is [from root,
 * to root, length].
 */
export function orderOn(read, a, z) {
  const ax = read.axes[a], order = [], bounds = [], tight = [], all = things(read, a), b = 1 - a;
  const meet = (p, it) => {
    const d = p.at === it.at && p.kind === 'wire' && it.kind === 'wire' ? null : distance(p, it, a, z), e = d === null ? null : arc(ax, p.high, it.low, d);
    if (e) order.push(e);
    return e;
  };
  sweep(all, (p, it) => {
    const e = meet(p, it);
    // A shore and what stands on its island inside it: drawn in tight, so a band is no wider than what it holds.
    if (e && shore(p) !== shore(it) && (p.kind === 'lo' || it.kind === 'hi')) tight.push(e);
  });
  // Each island's frame, undrawn, sees what stands inside it as its border's rectangle did: the island pressed together
  // as one, while what is outside meets only its bands.
  for (const i of read.shores.islands) {
    const r = read.islands.get(i.id).rect, inside = all.filter((t) => !shore(t) && t.at > r[a] && t.at < r[a + 2] && t.lo >= r[b] && t.hi <= r[b + 2]);
    const frame = [0, 1].map((hi) => ({ low: i.frame[hi], high: i.frame[hi], kind: hi ? 'hi' : 'lo', island: read.islands.get(i.id), at: r[a + 2 * hi], lo: r[b], hi: r[b + 2], top: !hi }));
    sweep([...frame, ...inside], meet);
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
  // A port inside its band's side, and a band's lines in order down the island.
  for (const p of read.shores.ports) if (p.axis === a) (bound(p.lo, `n:${p.id}`, z.pad), bound(`n:${p.id}`, p.hi, z.pad));
  if (a === 1) for (const i of read.shores.islands) i.y.slice(1).forEach((key, j) => bound(i.y[j], key, z.wire));
  // Each band overlaps the next across as it did in the shape, so an island stays one piece of land.
  if (a === 0) for (const i of read.shores.islands) i.bands.slice(1).forEach((c, k) => {
    const up = i.bands[k];
    if (Math.min(up[3], c[3]) - Math.max(up[2], c[2]) < 2) return;
    (bound(i.x[k + 1][0], i.x[k][1], 2 * z.pad), bound(i.x[k][0], i.x[k + 1][1], 2 * z.pad));
  });
  return { order, bounds, caps, tight };
}
