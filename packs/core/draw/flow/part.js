// One connected part drawn from its topology: columns and rows by the longest path, a box over its wires, and a way for each
// wire. Layers: shape and metrics, not yet apart. Pure: a part's links in, places and lines out.

import { count } from './count.js';
import { wrongEnd } from './faults.js';
import { pair } from './polyline.js';
import { against, downward, sidesOf } from './topology.js';


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

/** What a part's picture costs before it is pulled tight: up wires first, then crossings, wires on the wrong side, and length. */
export function costOf(d, size, z) {
  const lines = [...d.points.values()], rect = (id) => { const [x, y] = d.places.get(id), s = size(id); return { l: x - s.w / 2, r: x + s.w / 2, t: y, u: y + s.h }; };
  let length = 0, wrong = 0;
  for (const w of lines) {
    for (let i = 1; i < w.points.length; i++) length += Math.abs(w.points[i][0] - w.points[i - 1][0]) + Math.abs(w.points[i][1] - w.points[i - 1][1]);
    if (wrongEnd(rect(w.from), rect(w.to), w.points[0]) || wrongEnd(rect(w.to), rect(w.from), w.points.at(-1))) wrong++;
  }
  return d.up * z.cost_up + count(lines.map((w) => w.points)).crossings * z.cost_cross + wrong * z.cost_wrong + length;
}

/** One connected part: places by item, and each visible link's points. `block` is an item's size with what hangs on it, `box` its own. */
export function drawPart(list, links, block, box, z, trial) {
  const { g, s, t, number, outerAt } = downward(links, list, z, trial), next = new Map();
  for (const k of g.owner.keys()) {
    const [a, b] = k.split('|');
    (next.get(a) ?? next.set(a, new Set()).get(a)).add(b);
    (next.get(b) ?? next.set(b, new Set()).get(b)).add(a);
  }
  const { left, right, LEFT, RIGHT } = sidesOf(g.faces, outerAt, number, s, t);
  const ghost = (v) => v.startsWith('ghost'), size = (v) => (ghost(v) ? { w: 0, h: z.turn, lead: 0 } : block(v));
  const rows = [...number.keys()], wiredTo = new Map(rows.map((v) => [v, [...next.get(v)].filter((w) => g.owner.get(pair(v, w)).visible)])), wired = (v) => wiredTo.get(v);
  // Each item's bar runs from the face that is only ever on the left of its wires to the one only ever on the right.
  const lefts = new Map(), rights = new Map();
  for (const k of g.owner.keys()) for (const v of k.split('|')) {
    (lefts.get(v) ?? lefts.set(v, new Set()).get(v)).add(left.get(k));
    (rights.get(v) ?? rights.set(v, new Set()).get(v)).add(right.get(k));
  }
  const ends = new Map(rows.map((v) => [v, [[...lefts.get(v)].find((f) => !rights.get(v).has(f)) ?? LEFT, [...rights.get(v)].find((f) => !lefts.get(v).has(f)) ?? RIGHT]]));
  const names = [LEFT, RIGHT, ...g.faces.map((_, i) => i).filter((i) => i !== outerAt)], xArcs = [];
  // An invisible edge draws nothing, so it needs next to no room.
  for (const k of g.owner.keys()) xArcs.push([left.get(k), right.get(k), g.owner.get(k).visible ? z.col : z.col / 8]);
  for (const v of rows) if (!ghost(v)) xArcs.push([ends.get(v)[0], ends.get(v)[1], size(v).w + z.col / 2]);
  const x = longest(names, xArcs);
  // A box sits over its own wires, as near their middle as its bar lets it, so they drop straight in.
  const inset = (v) => Math.min(z.corner, box(v).w / 3) + 1;
  const facesOf = new Map(rows.map((v) => [v, wired(v).map((w) => left.get(pair(v, w)))]));
  // A hub's faces are added up as they move, as it has too many to go over for every wire.
  const hubs = new Map([...facesOf].filter(([, f]) => f.length > z.hub_most).map(([v, f]) => [v, f.reduce((sum, c) => sum + x.get(c), 0)])), hubsOn = new Map();
  for (const v of hubs.keys()) for (const f of facesOf.get(v)) (hubsOn.get(f) ?? hubsOn.set(f, []).get(f)).push(v);
  const middle = (v) => {
    const [from, to] = ends.get(v);
    if (ghost(v)) return (x.get(from) + x.get(to) + z.col) / 2;
    const lo = x.get(from) + z.col / 2 - inset(v), hi = Math.max(lo, x.get(to) + z.col / 2 - inset(v) - size(v).w);
    const faces = facesOf.get(v);
    if (!faces.length) return lo + size(v).w / 2;
    let sum = hubs.get(v) ?? 0;
    if (!hubs.has(v)) for (const f of faces) sum += x.get(f);
    return Math.min(hi, Math.max(lo, sum / faces.length + z.col / 2 - box(v).w / 2)) + size(v).w / 2;
  };
  const column = (k) => x.get(left.get(k)) + z.col / 2;
  // Longest paths push every column as far left as it can go, so a wire can leave its box and come back the long way.
  // Each column slides toward the boxes its wires join, as far as the columns either side let it: their order is the
  // embedding, and it never changes.
  const centre = (v) => (ghost(v) ? middle(v) : middle(v) - size(v).w / 2 + box(v).w / 2);
  const earlier = new Map(names.map((n) => [n, []])), later = new Map(names.map((n) => [n, []])), wiresOf = new Map();
  for (const [p, q, l] of xArcs) (later.get(p).push([q, l]), earlier.get(q).push([p, l]));
  for (const [k, w] of g.owner) if (w.visible) (wiresOf.get(left.get(k)) ?? wiresOf.set(left.get(k), []).get(left.get(k))).push(k);
  for (let sweep = 0; sweep < z.slide_sweeps; sweep++) for (const f of sweep % 2 ? names : [...names].reverse()) {
    if (!wiresOf.has(f)) continue;
    const wants = wiresOf.get(f).flatMap((k) => k.split('|')).map(centre).sort((p, q) => p - q);
    const lo = Math.max(...earlier.get(f).map(([p, l]) => x.get(p) + l)), hi = Math.min(...later.get(f).map(([q, l]) => x.get(q) - l));
    if (lo > hi) continue;
    const was = x.get(f);
    x.set(f, Math.min(hi, Math.max(lo, wants[wants.length >> 1] - z.col / 2)));
    for (const v of hubsOn.get(f) ?? []) hubs.set(v, hubs.get(v) + x.get(f) - was);
  }
  // Every wire its own way into an item, so none runs along another. One under the box drops straight in; the rest come
  // along tracks of their own, the outermost column on the track nearest the box, landing on the box in that order.
  const landing = new Map(), tracks = new Map();
  for (const v of rows) {
    if (ghost(v)) continue;
    const near = wired(v), l = middle(v) - size(v).w / 2, r = l + box(v).w, pad = Math.min(z.corner, box(v).w / 3);
    for (const side of [-1, 1]) {
      const wires = near.filter((w) => Math.sign(number.get(w) - number.get(v)) === side).map((w) => ({ k: pair(v, w), col: column(pair(v, w)) })).sort((p, q) => p.col - q.col);
      const straight = wires.filter((w) => w.col > l + pad && w.col < r - pad);
      const before = wires.filter((w) => w.col <= l + pad), past = wires.filter((w) => w.col >= r - pad).reverse();
      const from = straight.length ? straight[0].col : (l + r) / 2, to = straight.length ? straight.at(-1).col : (l + r) / 2;
      for (const w of straight) landing.set(`${v} ${w.k}`, { at: w.col, track: -1 });
      before.forEach((w, i) => landing.set(`${v} ${w.k}`, { at: l + pad + ((from - l - pad) * (i + 0.5)) / before.length, track: i }));
      past.forEach((w, i) => landing.set(`${v} ${w.k}`, { at: r - pad - ((r - pad - to) * (i + 0.5)) / past.length, track: i }));
      tracks.set(`${v} ${side}`, Math.max(before.length, past.length));
    }
  }
  const yArcs = [];
  for (const k of g.owner.keys()) {
    const [a, b] = k.split('|'), [u, v] = number.get(a) < number.get(b) ? [a, b] : [b, a];
    // An invisible edge only keeps the two in order.
    yArcs.push([u, v, size(u).h + (g.owner.get(k).visible ? Math.max(z.row, z.join, z.run * 2) + ((tracks.get(`${u} 1`) ?? 0) + (tracks.get(`${v} -1`) ?? 0)) * z.turn : z.turn)]);
  }
  const y = longest(rows, yArcs);
  const turned = new Map(), points = new Map();
  /** A wire's way out of an item to a column: its landing, its track, and the column. */
  const enter = (v, to, col) => {
    const side = number.get(to) > number.get(v) ? 1 : -1, edgeAt = side > 0 ? y.get(v) + size(v).h : y.get(v), mark = landing.get(`${v} ${pair(v, to)}`);
    const port = y.get(v) + size(v).lead + (side > 0 ? box(v).h : 0);
    if (mark.track < 0) return [[col, port]];
    const trackAt = edgeAt + side * (z.run + mark.track * z.turn);
    return [[mark.at, port], [mark.at, trackAt], [col, trackAt]];
  };
  for (const w of g.wires) {
    if (!w.visible) continue;
    const out = [], { path } = w;
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]], col = column(pair(a, b));
      if (ghost(a)) out.push([col, turned.get(`${a} ${w.link}`)]);
      else out.push(...enter(a, b, col));
      if (ghost(b)) {
        if (!turned.has(`${b} ${w.link}`)) {
          turned.set(b, (turned.get(b) ?? -1) + 1);
          turned.set(`${b} ${w.link}`, y.get(b) + turned.get(b) * z.turn);
        }
        out.push([col, turned.get(`${b} ${w.link}`)]);
      } else out.push(...enter(b, a, col).reverse());
    }
    points.set(pair(w.link[0], w.link[1]), { from: w.link[0], to: w.link[1], points: out });
  }
  const places = new Map(rows.filter((v) => !ghost(v)).map((v) => [v, [middle(v), y.get(v)]]));
  return { places, points, crossings: g.crossings, up: against(g, number) };
}
