// A picture at right angles pulled tight, its topology kept. Each straight stretch of a wire is a rod that slides only
// across itself, and each box slides too: everything is pulled toward what it is joined to, and stops against whatever
// stands beside it. Nothing passes through anything, so no crossing can be made and none undone, and a wire that
// snakes pulls straight. One pass moves along one axis; the passes take turns. Pure: boxes and lines in, moved in place.

import { count, touch } from './count.js';

/** A pass that moves no point further than this has moved nothing. */
const STILL = 0.5;
/** How far a port keeps from a corner. */
const INSET = 2;
/** A box's own edges from the middle of its block, on one axis. What hangs beside it takes no port. */
const reachOf = (b, axis) => b.reach?.[axis] ?? [-b.size[axis] / 2, b.size[axis] / 2];
const insetOf = (b, axis, corner) => { const [lo, hi] = reachOf(b, axis); return Math.max(INSET, Math.min(corner, (hi - lo) / 3)); };
const spanOf = (b, axis, corner = INSET) => reachOf(b, axis).map((r, k) => b.at[axis] + r + (k ? -insetOf(b, axis, corner) : insetOf(b, axis, corner)));
const edgeOf = (b, axis, side) => b.at[axis] + reachOf(b, axis)[side > 0 ? 1 : 0];

const median = (list) => [...list].sort((p, q) => p - q)[list.length >> 1];

/** A line with repeated points and points along a straight run taken out. */
function simplify(points) {
  const out = [];
  for (const p of points) {
    if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) continue;
    if (out.length > 1) {
      const [a, b] = [out.at(-2), out.at(-1)];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop();
    }
    out.push([...p]);
  }
  return out;
}

/**
 * One pass along `axis` (0 across, 1 down). `boxes` are { at: [x, y], size: [w, h] } by id, `wires` { a, b, points }: a
 * wire's ends rest on the boxes `a` and `b`, and `down` says `a` stays above `b`. `gap` is the room between boxes, `track` between two wires,
 * `room` between a wire and a box it passes, `join` between two boxes a wire joins, and `run` from a port to the wire's first corner.
 */
function pass(axis, boxes, wires, { gap, track, room, join, run, corner, sweeps, press, blocks }) {
  const other = 1 - axis, items = [], ofBox = new Map(), landed = [];
  for (const [id, b] of boxes) {
    const [low, high] = reachOf(b, axis), inset = insetOf(b, axis, corner), hold = [low + inset, high - inset];
    const it = { box: id, low, high, from: hold[0], to: hold[1], pos: b.at[axis], half: b.size[axis] / 2, lo: b.at[other] - b.size[other] / 2, hi: b.at[other] + b.size[other] / 2, joins: [] };
    ofBox.set(id, it);
    items.push(it);
  }
  for (const w of wires) {
    w.points = simplify(w.points);
    const rods = new Map();
    for (let i = 1; i < w.points.length; i++) {
      const [p, q] = [w.points[i - 1], w.points[i]];
      if (p[axis] !== q[axis]) continue;
      const rod = { w, i, pos: p[axis], half: 0, lo: Math.min(p[other], q[other]), hi: Math.max(p[other], q[other]), joins: [] };
      rods.set(i, rod);
      items.push(rod);
    }
    for (const [i, rod] of rods) {
      const before = rods.get(i - 2) ?? (i <= 2 ? ofBox.get(w.a) : null), after = rods.get(i + 2) ?? (i >= w.points.length - 2 ? ofBox.get(w.b) : null);
      if (i === 1) rod.own = ofBox.get(w.a);
      if (i === w.points.length - 1) rod.own2 = ofBox.get(w.b);
      for (const near of [before, after]) if (near) (rod.joins.push(near), near.box && near.joins.push(rod));
      // The first corner stays clear of a port, for the head that lands there.
      if (i === 2) landed.push([rod, ofBox.get(w.a), w.points[0][axis]]);
      if (i === w.points.length - 2) landed.push([rod, ofBox.get(w.b), w.points.at(-1)[axis]]);
    }
  }
  // Two rods at one place, along one another: which side each is on is told by how it turns where it stops beside the
  // other. A rod that turns toward higher numbers there must already be on that side, or it would cross the other.
  const rodsAt = new Map();
  for (const it of items) if (it.w) (rodsAt.get(it.pos) ?? rodsAt.set(it.pos, []).get(it.pos)).push(it);
  for (const group of rodsAt.values()) for (const rod of group) {
    const pts = rod.w.points, [p, q] = [pts[rod.i - 1], pts[rod.i]], [before, after] = [pts[rod.i - 2], pts[rod.i + 1]];
    rod.tie = 0;
    for (const peer of group) {
      if (peer === rod) continue;
      if (before && p[other] >= peer.lo && p[other] <= peer.hi) rod.tie += Math.sign(before[axis] - rod.pos);
      if (after && q[other] >= peer.lo && q[other] <= peer.hi) rod.tie += Math.sign(after[axis] - rod.pos);
    }
  }
  items.sort((p, q) => p.pos - q.pos || (p.tie ?? 0) - (q.tie ?? 0));
  items.forEach((it, k) => { it.k = k; it.left = []; it.right = []; });
  const margin = track / 2;
  // Only what overlaps across is compared: walked in order of where each starts across, the items still open.
  const across = [...items].sort((p, q) => p.lo - q.lo);
  let open = [];
  for (const it of across) {
    open = open.filter((o) => o.hi + margin >= it.lo);
    for (const o of open) {
      const [p, q] = o.k < it.k ? [o, it] : [it, o];
      if (p.w && p.w === q.w) continue;
    // A rod that ends on a box stays on it, inside its edges; that is its bound, not the box's being beside it.
      const onP = (p.own === q || p.own2 === q) && q.box, onQ = (q.own === p || q.own2 === p) && p.box;
      if (onP || onQ) continue;
      const want = p.box && q.box ? p.half + q.half + gap : p.half + q.half + (p.box || q.box ? room : track), sep = Math.min(want, q.pos - p.pos);
      p.right.push([q, sep]);
      q.left.push([p, sep]);
    }
    open.push(it);
  }
  const hold = (p, q, want) => {
    const sep = Math.min(want, q.pos - p.pos);
    p.right.push([q, sep]);
    q.left.push([p, sep]);
  };
  // Boxes a wire joins keep room for it, and down the page a wire of the order keeps its box above the one it leads to,
  // however it could bend to let it pass.
  for (const w of wires) {
    const [p, q] = [ofBox.get(w.a), ofBox.get(w.b)];
    if (!p || !q) continue;
    const [lo, hi] = p.pos <= q.pos ? [p, q] : [q, p], reach = lo.high - hi.low;
    if (hi.pos - lo.pos >= reach && (axis === 1 || (lo.lo < hi.hi && hi.lo < lo.hi))) hold(lo, hi, reach + join);
    else if (axis === 1 && w.down && p.pos < q.pos) hold(p, q, p.half + q.half);
  }
  for (const [rod, box, port] of landed) if (box) {
    const edge = port - box.pos;
    if (rod.pos >= port) hold(box, rod, edge + run); else hold(rod, box, -edge + run);
  }
  const bounds = (it) => {
    let lo = -Infinity, hi = Infinity;
    for (const [p, s] of it.left) lo = Math.max(lo, p.pos + s);
    for (const [q, s] of it.right) hi = Math.min(hi, q.pos - s);
    // A rod's end stays on the box itself, not on what hangs beside it (`hold`, the box's reach from the block's middle).
    for (const box of [it.own, it.own2]) if (box) ((lo = Math.max(lo, box.pos + box.from)), (hi = Math.min(hi, box.pos + box.to)));
    if (it.box) for (const rod of it.joins) if (rod.own === it || rod.own2 === it) ((lo = Math.max(lo, rod.pos - it.to)), (hi = Math.min(hi, rod.pos - it.from)));
    return [lo, hi];
  };
  // The press, rows only: pressing across lengthens wires, pressing down shortens them (measured on a real map).
  // The press: everything moves toward the low side until something stops it, which closes the empty space. It keeps
  // every order, so it changes nothing but the room taken.
  if (press) for (let sweep = 0; sweep < 4; sweep++) for (const it of items) {
    const [lo, hi] = bounds(it);
    if (Number.isFinite(lo) && lo <= hi && lo < it.pos) it.pos = lo;
  }
  for (let sweep = 0; sweep < sweeps; sweep++) for (const it of sweep % 2 ? [...items].reverse() : items) {
    if (!it.joins.length) continue;
    const [lo, hi] = bounds(it);
    if (lo <= hi) it.pos = Math.min(hi, Math.max(lo, median(it.joins.map((j) => j.pos))));
  }
  if (blocks) slideBlocks(items, bounds, blocks);
  for (const it of items) if (it.box) {
    const b = boxes.get(it.box), move = it.pos - b.at[axis];
    b.at[axis] = it.pos;
    for (const w of wires) {
      if (w.a === it.box && w.points[0][axis] === w.points[1]?.[axis] === false) w.points[0][axis] += move;
      if (w.b === it.box && w.points.at(-1)[axis] === w.points.at(-2)?.[axis] === false) w.points.at(-1)[axis] += move;
    }
  }
  for (const it of items) if (it.w) (it.w.points[it.i - 1][axis] = it.pos, it.w.points[it.i][axis] = it.pos);
}

/** How near its bound an item stands to be stopped by it, and how far a move must go to count. */
const TIGHT = 0.5, SETTLED = 0.5;

/**
 * Move what stands stopped against each other as one: items held tight by a separation are a block, which goes to the
 * median of all that its members join outside it, as far as what stands beside the block lets it. Single items then
 * take their own medians again, which is how a block comes apart when its members want different ways. Runs until
 * nothing moves, or for `limit` rounds.
 */
function slideBlocks(items, bounds, limit) {
  for (let round = 0; round < limit; round++) {
    const root = new Map(items.map((it) => [it, it])), find = (it) => (root.get(it) === it ? it : (root.set(it, find(root.get(it))), root.get(it)));
    for (const it of items) for (const [q, s] of it.right) if (q.pos - it.pos - s < TIGHT) root.set(find(it), find(q));
    const groups = new Map();
    for (const it of items) (groups.get(find(it)) ?? groups.set(find(it), []).get(find(it))).push(it);
    let moved = 0;
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const inside = new Set(members), pulls = [];
      let lo = -Infinity, hi = Infinity;
      for (const m of members) {
        for (const j of m.joins) if (!inside.has(j)) pulls.push(j.pos - m.pos);
        for (const [p, s] of m.left) if (!inside.has(p)) lo = Math.max(lo, p.pos + s - m.pos);
        for (const [q, s] of m.right) if (!inside.has(q)) hi = Math.min(hi, q.pos - s - m.pos);
        for (const box of [m.own, m.own2]) if (box && !inside.has(box)) ((lo = Math.max(lo, box.pos + box.from - m.pos)), (hi = Math.min(hi, box.pos + box.to - m.pos)));
        if (m.box) for (const rod of m.joins) if ((rod.own === m || rod.own2 === m) && !inside.has(rod)) ((lo = Math.max(lo, rod.pos - m.to - m.pos)), (hi = Math.min(hi, rod.pos - m.from - m.pos)));
      }
      if (!pulls.length || lo > hi) continue;
      const shift = Math.min(hi, Math.max(lo, median(pulls)));
      if (Math.abs(shift) < SETTLED) continue;
      for (const m of members) m.pos += shift;
      moved++;
    }
    let single = 0;
    for (const it of round % 2 ? [...items].reverse() : items) {
      if (!it.joins.length) continue;
      const [lo, hi] = bounds(it);
      if (lo > hi) continue;
      const to = Math.min(hi, Math.max(lo, median(it.joins.map((j) => j.pos))));
      if (Math.abs(to - it.pos) >= SETTLED) single++;
      it.pos = to;
    }
    if (!moved && !single) return;
  }
}

/** Whether this line is free to be drawn: through no box, and crossing and touching no wire it did not already. */
function allowed(line, was, w, boxes, wires) {
  for (let i = 1; i < line.length; i++) {
    const [p, q] = [line[i - 1], line[i]], l = Math.min(p[0], q[0]), r = Math.max(p[0], q[0]), t = Math.min(p[1], q[1]), u = Math.max(p[1], q[1]);
    for (const b of boxes.values()) {
      const [bl, br] = [b.at[0] - b.size[0] / 2 + INSET, b.at[0] + b.size[0] / 2 - INSET], [bt, bu] = [b.at[1] - b.size[1] / 2 + INSET, b.at[1] + b.size[1] / 2 - INSET];
      if (r > bl && l < br && u > bt && t < bu) return false;
    }
  }
  const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]), [l, r, t, u] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (const v of wires) {
    if (v === w || v.points.every((p) => p[0] < l) || v.points.every((p) => p[0] > r) || v.points.every((p) => p[1] < t) || v.points.every((p) => p[1] > u)) continue;
    if (count([line, v.points]).crossings > count([was, v.points]).crossings) return false;
    if (touch(line, v.points) && !touch(was, v.points)) return false;
  }
  return true;
}

/**
 * Slide a wire's ends round the boxes they rest on, corners and all, wherever that takes out a bend and the line stays
 * free. A wire that reaches a box along the side it lands on comes straight into that side; one that passes a corner to
 * get there stops at the side it meets first.
 */
function slidePorts(boxes, wires, run, corner) {
  let moved = 0;
  for (const w of wires) for (const atEnd of [true, false]) {
    const b = boxes.get(atEnd ? w.b : w.a), was = simplify(w.points), line = atEnd ? was : [...was].reverse(), n = line.length;
    if (n < 3) continue;
    const [C, B, A, P] = [line[n - 1], line[n - 2], line[n - 3], line[n - 4]], e = B[0] === C[0] ? 1 : 0, o = 1 - e;
    const [lo, hi] = spanOf(b, e, corner), [olo, ohi] = spanOf(b, o), side = Math.sign(A[o] - (olo + ohi) / 2) || 1;
    if (o === 0 && side > 0 && reachOf(b, 0)[1] < b.size[0] / 2) continue;
    const landing = (at) => { const c = []; c[e] = at; c[o] = edgeOf(b, o, side); return c; };
    const outside = A[o] < olo - INSET || A[o] > ohi + INSET;
    if (!outside) continue;
    let next = null;
    if (A[e] >= lo && A[e] <= hi) next = [...line.slice(0, n - 2), landing(A[e])];
    else if (n >= 4 && P[o] === A[o]) {
      const mid = (lo + hi) / 2, corner = []; corner[o] = A[o]; corner[e] = mid;
      next = [...line.slice(0, n - 3), corner, landing(mid)];
    }
    if (!next || Math.abs(next.at(-1)[o] - next.at(-2)[o]) + Math.abs(next.at(-1)[e] - next.at(-2)[e]) < run) continue;
    const drawn = atEnd ? next : [...next].reverse();
    if (allowed(drawn, was, w, new Map([...boxes].filter(([id]) => id !== w.a && id !== w.b)), wires)) ((w.points = drawn), moved++);
  }
  return moved;
}

/** Whether every stretch of these lines is across or down: the pull works on those alone. */
export const square = (wires) => wires.every((w) => w.points.every((p, i) => !i || p[0] === w.points[i - 1][0] || p[1] === w.points[i - 1][1]));

/**
 * Pull a picture tight: `rounds` of one pass each way, moving `boxes` and `wires` in place. A pass that left more
 * crossings than it found is taken back, whatever the reason: the crossings kept are a promise, not a hope. Answers
 * with what was done, for `watch`.
 */
export function settle(boxes, wires, { gap, track, room = track, join = gap, run = 0, corner = INSET, rounds = 12, sweeps = 16, blocks = 0, watch = null }) {
  const crossings = () => count(wires.map((w) => w.points)).crossings;
  const save = () => ({ at: new Map([...boxes].map(([id, b]) => [id, [...b.at]])), lines: wires.map((w) => w.points.map((q) => [...q])) });
  const restore = (kept) => {
    for (const [id, at] of kept.at) boxes.get(id).at = at;
    wires.forEach((w, k) => (w.points = kept.lines[k]));
  };
  let done = 0, undone = 0, slid = 0, still = 0, now = crossings();
  for (let round = 0; round < rounds && still < 2; round++) for (const axis of [0, 1]) {
    const before = now, kept = save();
    pass(axis, boxes, wires, { gap, track, room, join, run, corner, sweeps, blocks, press: axis === 1 && round < rounds / 2 });
    const after = crossings();
    now = after;
    watch?.({ round, axis, before, after, kept, wires, boxes });
    // In the first round, wires that only touched may come apart as the crossing they always were: a touch hides a crossing the count
    // cannot see. Any other pair that crosses now and did not before takes the pass back.
    const made = after > before && (round > 0 || wires.some((w, i) => wires.some((v, j) => j > i && count([w.points, v.points]).crossings > count([kept.lines[i], kept.lines[j]]).crossings && !touch(kept.lines[i], kept.lines[j]))));
    if (made) (restore(kept), undone++, (now = before));
    else done++;
    const slides = axis ? slidePorts(boxes, wires, run, corner) : 0;
    slid += slides;
    if (slides) now = crossings();
    // Two passes running that move nothing: it stands, and the rounds left would change nothing.
    const moved = slides || wires.some((w, k) => w.points.length !== kept.lines[k].length || w.points.some((q, i) => Math.abs(q[0] - kept.lines[k][i][0]) + Math.abs(q[1] - kept.lines[k][i][1]) > STILL));
    still = moved ? 0 : still + 1;
  }
  return { done, undone, slid };
}
