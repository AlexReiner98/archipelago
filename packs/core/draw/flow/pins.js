// A step put by hand is a pin: the picture as the solve left it, with every pin at its place, is one call, so a drag frame, a
// release and a reload draw the same wires. Nothing but what is pinned moves, with what hangs on it. A wire of a pinned step
// keeps its shape and is stretched; where that no longer holds (it runs back into its step or through a box, or crosses more
// than it did) it is threaded through what stands, unless that does no better. It keeps the port it had on the step that did
// not move. A wire a pin comes to stand on goes round it. The solve then parts them all, the rest held. Layer: metrics, over
// what ./ways.js shapes. Pure: pins in, places and lines out, nothing kept but what can be worked out again.

import { tidy } from './polyline.js';
import { settle } from './solve.js';
import { fieldOf, waysFrom } from './ways.js';

const turned = (line) => [...line].reverse();
const rectAt = (id, x, y, nodes, by = 0) => { const n = nodes.get(id); return { id, l: x.get(id) - n.w / 2 - by, r: x.get(id) + n.w / 2 + by, t: y.get(id) - n.h / 2 - by, u: y.get(id) + n.h / 2 + by }; };

/** What a line takes up, `by` further each way. */
const spanOf = (line, by) => ({ l: Math.min(...line.map((p) => p[0])) - by, r: Math.max(...line.map((p) => p[0])) + by, t: Math.min(...line.map((p) => p[1])) - by, u: Math.max(...line.map((p) => p[1])) + by });

/** Whether a stretch passes through the inside of a rectangle. */
const meets = (p, q, { l, r, t, u }) => Math.max(p[0], q[0]) > l && Math.min(p[0], q[0]) < r && Math.max(p[1], q[1]) > t && Math.min(p[1], q[1]) < u;

/** `line` with its first point moved by `d`: the stretch that leaves it goes along, and what comes next takes up the difference. */
function carry(line, d) {
  const l = line.map((p) => [...p]), along = l[0][0] === l[1][0] ? 1 : 0, across = 1 - along;
  l[0] = [l[0][0] + d[0], l[0][1] + d[1]];
  if (l.length > 2) {
    l[1][across] += d[across];
    return kept(l);
  }
  const mid = (l[0][along] + l[1][along]) / 2, bend = (from) => { const p = []; p[across] = from[across]; p[along] = mid; return p; };
  return kept([l[0], bend(l[0]), bend(l[1]), l[1]]);
}

/** A line tidied, two points at the least, as every line is. */
const kept = (line) => (tidy(line).length > 1 ? tidy(line) : [line[0], line.at(-1)]);

/** Where a line stops being a stretch into its last box: `run` short of it, or its last turn if that is nearer. */
function tipOf(line, run) {
  const [q, p] = [line.at(-2), line.at(-1)], long = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]), t = Math.min(1, run / (long || 1));
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}

/** The way round `box` from where `line` first meets it to where it last leaves it, the shorter way; the line as it was if it starts or ends inside. */
function around(line, box) {
  const inner = (p) => p[0] > box.l && p[0] < box.r && p[1] > box.t && p[1] < box.u;
  if (inner(line[0]) || inner(line.at(-1))) return line;
  const clip = (from, to) => (from[0] === to[0] ? [from[0], from[1] < to[1] ? box.t : box.u] : [from[0] < to[0] ? box.l : box.r, from[1]]);
  let first = -1, last = -1;
  for (let k = 1; k < line.length; k++) if (meets(line[k - 1], line[k], box)) ((first = first < 0 ? k : first), (last = k));
  if (first < 0) return line;
  const a = clip(line[first - 1], line[first]), b = clip(line[last], line[last - 1]);
  const ring = [[box.l, box.t], [box.r, box.t], [box.r, box.u], [box.l, box.u]];
  const place = ([x, y]) => (y === box.t ? x - box.l : x === box.r ? box.r - box.l + y - box.t : y === box.u ? box.r - box.l + box.u - box.t + box.r - x : 2 * (box.r - box.l) + box.u - box.t + box.u - y);
  const whole = 2 * (box.r - box.l + box.u - box.t), [from, to] = [place(a), place(b)], forth = (to - from + whole) % whole;
  const corners = ring.map((c) => [c, (place(c) - from + whole) % whole]);
  const by = forth <= whole / 2 ? corners.filter(([, far]) => far < forth).sort((p, q) => p[1] - q[1]) : corners.filter(([, far]) => far > forth).sort((p, q) => q[1] - p[1]);
  return kept([...line.slice(0, first), a, ...by.map(([c]) => c), b, ...line.slice(last)]);
}

/**
 * `x`, `y`, `nodes` and `routes` are what the solve left, by item and by link; `rigid` says what `hangs` on an item. Answers
 * with what the picture is for any pins: `pinned(placed)` gives the places, the items that moved and the lines changed, by
 * link. A wire and a field already worked out are kept for the next call: what they were worked out from is in their key.
 */
export function pinner({ nodes, x, y, routes, rigid, lengths }) {
  const { room, run, corner, cross, step } = lengths;
  const wires = [...routes].filter(([, r]) => r.points.length > 1).map(([k, r]) => { const [p, q] = k.split('|'); return { k, a: r.from, b: r.from === p ? q : p, points: r.points }; });
  const wiresOf = new Map();
  for (const w of wires) for (const id of [w.a, w.b]) (wiresOf.get(id) ?? wiresOf.set(id, []).get(id)).push(w);
  const hangs = (id) => rigid.get(id)?.hangs ?? [];
  const boxes = [...x.keys()].map((id) => rectAt(id, x, y, nodes));
  /** The stretches of what stands, leaving out the wires of `id`. */
  const stands = new Map(), standing = (id) => stands.get(id) ?? stands.set(id, wires.filter((w) => w.a !== id && w.b !== id).map((w) => w.points)).get(id);
  /** How many of those a line crosses. */
  const crossings = (line, id) => {
    let n = 0;
    for (const w of standing(id)) for (let j = 1; j < w.length; j++) for (let k = 1; k < line.length; k++) {
      const [p, q, r, s] = [line[k - 1], line[k], w[j - 1], w[j]];
      if (p[0] === q[0] && r[1] === s[1] && Math.min(r[0], s[0]) < p[0] && Math.max(r[0], s[0]) > p[0] && Math.min(p[1], q[1]) < r[1] && Math.max(p[1], q[1]) > r[1]) n++;
      if (p[1] === q[1] && r[0] === s[0] && Math.min(r[1], s[1]) < p[1] && Math.max(r[1], s[1]) > p[1] && Math.min(p[0], q[0]) < r[0] && Math.max(p[0], q[0]) > r[0]) n++;
    }
    return n;
  };
  const fields = new Map(), trees = new Map(), lines = new Map();

  /** The field round `id`, as far as `tips` and how `close` it is ask for it. */
  const fieldFor = (id, tips, close) => {
    const key = `${id} ${close}`, sign = JSON.stringify(tips), out = new Set([id, ...hangs(id)]);
    if (fields.get(key)?.sign !== sign) fields.set(key, { sign, field: fieldOf({ boxes: boxes.filter((b) => !out.has(b.id)), wires: standing(id), tips, room, step, near: close ? room / 2 : room, close }) });
    return fields.get(key).field;
  };

  /** The ways from step `id` moved by `d` to the far end of each of its wires, those moved too by `shift`. */
  const treeOf = (id, d, shift) => {
    const others = wiresOf.get(id).map((w) => shift.get(w.a === id ? w.b : w.a) ?? 0), key = JSON.stringify([d, others]);
    if (trees.get(id)?.key === key) return trees.get(id).by;
    const far = wiresOf.get(id).map((w, k) => {
      const line = w.a === id ? w.points : turned(w.points);
      return { w, line: others[k] ? turned(carry(turned(line), others[k])) : line };
    });
    const tips = far.map((f) => tipOf(f.line, run)), box = rectAt(id, x, y, nodes);
    for (const side of ['l', 'r']) box[side] += d[0];
    for (const side of ['t', 'u']) box[side] += d[1];
    const sides = hangs(id).length ? ['top', 'foot', 'left'] : ['top', 'foot', 'left', 'right'], how = { turn: lengths.turn, cross, run, inset: Math.min(corner, Math.min(box.r - box.l, box.u - box.t) / 3) };
    const coarse = waysFrom(fieldFor(id, tips, false), box, sides, tips, how);
    // Most ways go by the wider lines; those that do not are looked for close beside the boxes.
    const missing = tips.filter((_, k) => !coarse[k]), close = missing.length ? waysFrom(fieldFor(id, tips, true), box, sides, missing, how) : [];
    const ways = coarse.map((way) => way ?? close.shift());
    trees.set(id, { key, by: new Map(far.map((f, k) => [f.w.k, { way: ways[k], tip: tips[k], line: f.line }])) });
    return trees.get(id).by;
  };

  /** A wire that stood where a pin now stands, threaded from one of its ends to the other past `stood`; null if none goes. */
  const past = (w, stood) => {
    const tips = [tipOf(turned(w.points), run), tipOf(w.points, run)], sign = JSON.stringify(tips);
    if (fields.get(w.k)?.sign !== sign) fields.set(w.k, { sign, field: fieldOf({ boxes, wires: wires.filter((v) => v !== w).map((v) => v.points), tips, room, step, near: room / 2, close: true }) });
    const [way] = waysFrom(fields.get(w.k).field, { l: tips[0][0], r: tips[0][0], t: tips[0][1], u: tips[0][1] }, ['top', 'foot', 'left', 'right'], [tips[1]], { turn: lengths.turn, cross, run: 0, inset: 0, avoid: stood });
    return way && kept([w.points[0], ...way, tips[1], w.points.at(-1)]);
  };

  /** A wire with one end or both moved: from the end that moved first, to the other. */
  const rewired = (w, shift) => {
    const [da, db] = [shift.get(w.a), shift.get(w.b)], id = da ? w.a : w.b, other = da ? w.b : w.a, d = da ?? db, by = shift.get(other);
    const base = w.a === id ? w.points : turned(w.points), line = turned(by ? carry(turned(carry(base, d)), by) : turned(carry(base, d)));
    const ends = new Set([id, other, ...hangs(id), ...hangs(other)]), others = boxes.filter((b) => !ends.has(b.id));
    const clear = (l) => l.every((p, k) => !k || !others.some((b) => meets(l[k - 1], p, b)));
    const along = base[0][0] === base[1][0] ? 1 : 0, keeps = Math.sign(line[1][along] - line[0][along]) === Math.sign(base[1][along] - base[0][along]);
    const box = rectAt(id, x, y, nodes);
    for (const side of ['l', 'r']) box[side] += d[0];
    for (const side of ['t', 'u']) box[side] += d[1];
    const fine = keeps && clear(line) && line.every((p, k) => k < 2 || !meets(line[k - 1], p, box));
    const was = crossings(base, id);
    const asDrawn = (l) => (w.a === id ? l : turned(l));
    if (fine && crossings(line, id) <= was) return asDrawn(line);
    const found = treeOf(id, d, shift).get(w.k);
    if (!found.way) return asDrawn(line);
    // From the tip the wire goes on as it did into the box it lands on.
    const threaded = kept([...found.way, found.tip, found.line.at(-1)]);
    return asDrawn(!fine || crossings(threaded, id) < crossings(line, id) ? threaded : line);
  };

  return (placed) => {
    const hand = Object.keys(placed ?? {}).filter((id) => x.has(id) && Array.isArray(placed[id])).sort();
    const X = new Map(x), Y = new Map(y), shift = new Map(), changed = new Map();
    for (const id of hand) {
      const d = [Number(placed[id][0]) - x.get(id), Number(placed[id][1]) - y.get(id)];
      if (!d[0] && !d[1]) continue;
      shift.set(id, d);
      for (const kid of hangs(id)) if (!Array.isArray(placed[kid])) shift.set(kid, d);
    }
    if (!shift.size) return { x: X, y: Y, moved: shift, lines: changed };
    for (const [id, [dx, dy]] of shift) (X.set(id, x.get(id) + dx), Y.set(id, y.get(id) + dy));
    const free = new Set();
    for (const w of wires) {
      const [da, db] = [shift.get(w.a), shift.get(w.b)];
      if (!da && !db) continue;
      // Two ends that moved as one carry their wire as it stands: a comb goes with its holder.
      if (da && db && da[0] === db[0] && da[1] === db[1]) {
        changed.set(w.k, w.points.map(([p, q]) => [p + da[0], q + da[1]]));
        continue;
      }
      const sign = JSON.stringify([da, db]);
      if (lines.get(w.k)?.sign !== sign) lines.set(w.k, { sign, line: rewired(w, shift) });
      changed.set(w.k, lines.get(w.k).line);
      free.add(w.k);
    }
    const stood = [...shift.keys()].map((id) => rectAt(id, X, Y, nodes, room - 1));
    for (const w of wires) {
      const was = changed.get(w.k) ?? w.points;
      if (changed.has(w.k) && !free.has(w.k)) continue;
      let line = was;
      for (const box of stood) if (box.id !== w.a && box.id !== w.b) line = around(line, box);
      if (line === was) continue;
      const beside = boxes.filter((b) => b.id !== w.a && b.id !== w.b && !shift.has(b.id));
      if (line.some((p, k) => k && beside.some((b) => meets(line[k - 1], p, b)))) line = past(w, stood) ?? line;
      changed.set(w.k, line);
      free.add(w.k);
    }
    if (!free.size) return { x: X, y: Y, moved: shift, lines: changed };
    const moved = new Set(shift.keys()), every = wires.map((w) => ({ k: w.k, a: w.a, b: w.b, points: changed.get(w.k) ?? w.points, free: free.has(w.k) ? moved : null }));
    // The solve is told only what can stand beside a wire that may move: nothing else asks a distance of it.
    const reach = room + lengths.wire, spans = every.filter((l) => l.free).map((l) => spanOf(l.points, reach));
    const near = (s) => spans.some((o) => s.l <= o.r && s.r >= o.l && s.t <= o.u && s.u >= o.t);
    const list = every.filter((l) => l.free || near(spanOf(l.points, 0)));
    const needed = new Set(list.flatMap((l) => [l.a, l.b]));
    const stands = [...x.keys()].filter((id) => needed.has(id) || near(rectAt(id, X, Y, nodes)));
    const told = settle({ boxes: stands.map((id) => { const n = nodes.get(id); return { id, at: [X.get(id), Y.get(id)], size: [n.w, n.h], named: [n.w, n.h] }; }), lines: list, ...lengths });
    for (const l of list) if (l.free) changed.set(l.k, l.points.length > 1 ? l.points : [l.points[0], l.points[0]]);
    return { x: X, y: Y, moved: shift, lines: changed, told };
  };
}
