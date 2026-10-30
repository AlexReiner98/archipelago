// A graph drawn from its planar embedding as a visibility representation (Tamassia and Tollis): each item a bar across a
// run of columns, each wire straight down a column from one bar to another, so the planar part cannot cross and every
// wire is at right angles. An st-numbering sets the rows, the faces between the wires set the columns, and the longest
// path through each keeps both as tight as they can be. Trees hang in combs beside their item. Pure: an answer in,
// geometry out, as the flow's layout answers.

import { comb, peel } from './combs.js';
import { count } from './count.js';
import { wrongEnd } from './faults.js';
import { flatten, ORDER } from './graph.js';
import { numbered } from './numbering.js';
import { stepsOf } from './plane.js';
import { reroute } from './reroute.js';
import { settle, square } from './settle.js';
import { planarize } from './thread.js';
import { embed } from './upward.js';

/** The ways a part may be drawn, a fixed order of its ties and which face is outer, the likeliest first: the style says how many. */
const TRIALS = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2]].map(([ties, nth]) => ({ ties, nth }));
/** Past this many wires the pull takes fewer rounds: a drawing that takes too long is stopped by the page. */
const PULL_MOST = 150;

let last = null;
/** What the last layout drew, for the count in the key. */
export const latest = () => last;
const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Each stretch's face to its left and right, walking out from the outer face; each face's two sides. */
function sidesOf(list, outerAt, number, s, t) {
  const byEdge = new Map();
  list.forEach((f, i) => f.forEach((a, k) => {
    const e = pair(a, f[(k + 1) % f.length]);
    (byEdge.get(e) ?? byEdge.set(e, []).get(e)).push(i);
  }));
  const chains = (f) => {
    const low = f.reduce((m, v, i) => (number.get(v) < number.get(f[m]) ? i : m), 0), n = f.length;
    const run = (step) => {
      const out = [];
      for (let i = low; ; i = (i + step + n) % n) {
        const j = (i + step + n) % n;
        out.push(pair(f[i], f[j]));
        if (number.get(f[j]) < number.get(f[i])) throw new Error('A face has more than one top');
        if (number.get(f[(j + step + n) % n]) < number.get(f[j]) || (j + step + n) % n === low) break;
      }
      return out;
    };
    return [run(1), run(-1)];
  };
  const left = new Map(), right = new Map(), LEFT = -1, RIGHT = -2, seen = new Set([outerAt]);
  const other = (e, i) => (byEdge.get(e) ?? []).find((f) => f !== i);
  const visit = (i, e, isRight) => {
    if (seen.has(i)) return;
    seen.add(i);
    const [a, b] = chains(list[i]), near = a.includes(e) ? a : b, far = near === a ? b : a;
    for (const x of near) (isRight ? right : left).set(x, i);
    for (const x of far) (isRight ? left : right).set(x, i);
    for (const x of near) { const o = other(x, i); if (o !== undefined && o !== outerAt) visit(o, x, !isRight); }
    for (const x of far) { const o = other(x, i); if (o !== undefined && o !== outerAt) visit(o, x, isRight); }
  };
  const st = pair(s, t), [a, b] = chains(list[outerAt]), [mine, rest] = a.length === 1 && a[0] === st ? [a, b] : [b, a];
  right.set(mine[0], RIGHT);
  for (const e of rest) left.set(e, LEFT);
  const inside = other(st, outerAt);
  visit(inside, st, false);
  for (const e of rest) { const o = other(e, outerAt); if (o !== undefined) visit(o, e, true); }
  for (const e of byEdge.keys()) if (!left.has(e) || !right.has(e)) throw new Error('A stretch has no side');
  return { left, right, LEFT, RIGHT };
}

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

/** How many order wires run against `number`. */
const against = (g, number) => g.wires.filter((w) => w.link?.[2] && w.path.some((v, i) => i && number.get(w.path[i - 1]) > number.get(v))).length;

/**
 * The part's graph and numbering. The heaviest planar part, numbered as the order asks, is the picture with the fewest
 * crossings; where that leaves order wires up, the embedding made for the order (./upward.js) is tried in its place.
 */
function downward(links, list, z, { ties = 0, nth = 0 } = {}) {
  // By name, so the picture does not change with the order the answer came in. Ties in another fixed order keep another
  // planar part, for the search in `best`.
  const keyOf = (l) => { const k = pair(l[0], l[1]); return ties === 1 ? [...k].reverse().join('') : ties === 2 ? k.slice(k.indexOf('|')) + k : k; };
  const name = (p, q) => (keyOf(p) < keyOf(q) ? -1 : 1);
  const ids = [...list].sort(), sorted = [...links].sort((p, q) => Number(q[2]) - Number(p[2]) || name(p, q) * (ties === 3 ? -1 : 1));
  const g = planarize(sorted, ids), found = { g, ...numbered(g, nth) }, up = against(g, found.number);
  if (!up || list.length > z.embed_most || ties || nth) return found;
  const made = embed(sorted, ids);
  return against(made, made.number) < up && made.crossings <= g.crossings + up * z.embed_cost ? { g: made, s: made.s, t: made.t, number: made.number, outerAt: made.outerAt } : found;
}

/** What a part's picture costs before it is pulled tight: up wires first, then crossings, wires on the wrong side, and length. */
function costOf(d, size, z) {
  const lines = [...d.points.values()], rect = (id) => { const [x, y] = d.places.get(id), s = size(id); return { l: x - s.w / 2, r: x + s.w / 2, t: y, u: y + s.h }; };
  let length = 0, wrong = 0;
  for (const w of lines) {
    for (let i = 1; i < w.points.length; i++) length += Math.abs(w.points[i][0] - w.points[i - 1][0]) + Math.abs(w.points[i][1] - w.points[i - 1][1]);
    if (wrongEnd(rect(w.from), rect(w.to), w.points[0]) || wrongEnd(rect(w.to), rect(w.from), w.points.at(-1))) wrong++;
  }
  return d.up * z.cost_up + count(lines.map((w) => w.points)).crossings * z.cost_cross + wrong * z.cost_wrong + length;
}

/** One connected part: places by item, and each visible link's points. `block` is an item's size with what hangs on it, `box` its own. */
function drawPart(list, links, block, box, z, trial) {
  const { g, s, t, number, outerAt } = downward(links, list, z, trial), next = new Map();
  for (const k of g.owner.keys()) {
    const [a, b] = k.split('|');
    (next.get(a) ?? next.set(a, new Set()).get(a)).add(b);
    (next.get(b) ?? next.set(b, new Set()).get(b)).add(a);
  }
  const { left, right, LEFT, RIGHT } = sidesOf(g.faces, outerAt, number, s, t);
  const ghost = (v) => v.startsWith('ghost'), size = (v) => (ghost(v) ? { w: 0, h: z.turn, lead: 0 } : block(v));
  const rows = [...number.keys()], wired = (v) => [...next.get(v)].filter((w) => g.owner.get(pair(v, w)).visible);
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
  const inset = (v) => Math.min(z.room, box(v).w / 4) + 1;
  const middle = (v) => {
    const [from, to] = ends.get(v);
    if (ghost(v)) return (x.get(from) + x.get(to) + z.col) / 2;
    const lo = x.get(from) + z.col / 2 - inset(v), hi = Math.max(lo, x.get(to) + z.col / 2 - inset(v) - size(v).w);
    const cols = wired(v).map((w) => column(pair(v, w)));
    if (!cols.length) return lo + size(v).w / 2;
    return Math.min(hi, Math.max(lo, cols.reduce((sum, c) => sum + c, 0) / cols.length - box(v).w / 2)) + size(v).w / 2;
  };
  const column = (k) => x.get(left.get(k)) + z.col / 2;
  // Longest paths push every column as far left as it can go, so a wire can leave its box and come back the long way.
  // Each column slides toward the boxes its wires join, as far as the columns either side let it: their order is the
  // embedding, and it never changes.
  const centre = (v) => (ghost(v) ? middle(v) : middle(v) - size(v).w / 2 + box(v).w / 2);
  const earlier = new Map(names.map((n) => [n, []])), later = new Map(names.map((n) => [n, []])), wiresOf = new Map();
  for (const [p, q, l] of xArcs) (later.get(p).push([q, l]), earlier.get(q).push([p, l]));
  for (const [k, w] of g.owner) if (w.visible) (wiresOf.get(left.get(k)) ?? wiresOf.set(left.get(k), []).get(left.get(k))).push(k);
  for (let sweep = 0; sweep < 60; sweep++) for (const f of sweep % 2 ? names : [...names].reverse()) {
    if (!wiresOf.has(f)) continue;
    const wants = wiresOf.get(f).flatMap((k) => k.split('|')).map(centre).sort((p, q) => p - q);
    const lo = Math.max(...earlier.get(f).map(([p, l]) => x.get(p) + l)), hi = Math.min(...later.get(f).map(([q, l]) => x.get(q) - l));
    if (lo <= hi) x.set(f, Math.min(hi, Math.max(lo, wants[wants.length >> 1] - z.col / 2)));
  }
  // Every wire its own way into an item, so none runs along another. One under the box drops straight in; the rest come
  // along tracks of their own, the outermost column on the track nearest the box, landing on the box in that order.
  const landing = new Map(), tracks = new Map();
  for (const v of rows) {
    if (ghost(v)) continue;
    const near = wired(v), l = middle(v) - size(v).w / 2, r = l + box(v).w, pad = Math.min(z.turn, box(v).w / 4);
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

/** For a test or a bench: told how each pass went. */
let watching = null;
export const watch = (fn) => (watching = fn);

// Where a step was put by hand is not read here yet: places were kept against the flow's picture, and they would pull
// wires out of the collision system.
export function layout({ items: given, links: told = [], undrawn = [], measure, sizes, aspect = 1.6 }) {
  const { items, links } = flatten({ items: given, links: told, undrawn });
  const { nodes, edges, potential } = stepsOf({ items, links, measure, sizes });
  const margin = sizes.flow_margin, gap = sizes.flow_node_gap, zw = { room: sizes.plane_wire_room, join: sizes.plane_joined_room, run: sizes.plane_port_run };
  const zs = { trials: sizes.plane_trials, trial_most: sizes.plane_trial_most, cost_up: sizes.plane_cost_up, cost_cross: sizes.plane_cost_crossing, cost_wrong: sizes.plane_cost_wrong_side, embed_most: sizes.plane_embed_most, embed_cost: sizes.plane_embed_crossings };
  const z = { row: sizes.flow_layer_gap / 2, col: Math.max(gap / 2, zw.room * 2), turn: gap / 3, gap, ...zw, ...zs };
  const zc = { row: gap / 4, col: gap, stub: z.run, join: z.join }, combGap = Math.max(gap, z.join);
  const ties = links.filter((l) => l.type !== ORDER).map((l) => ({ a: l.from, b: l.to, type: l.type, ...(l.pending && { pending: l.pending }) }));
  const chains = edges.map((e) => ({ ...e, key: `${e.a} ${e.b}`, path: [e.a, e.b], dashed: potential.has(e.b) }));
  const every = [...chains, ...ties], stepSize = (id) => nodes.get(id);
  const a = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const w of every) if (w.a !== w.b && a.has(w.a) && a.has(w.b)) (a.get(w.a).add(w.b), a.get(w.b).add(w.a));
  const { kids, core } = peel(a);
  // What the order has before an item hangs above it, and the rest below; `lead` is the room over the box.
  const above = new Set(chains.map((c) => `${c.a} ${c.b}`));
  const sideOf = (p, k) => (above.has(`${p} ${k}`) ? 1 : above.has(`${k} ${p}`) ? -1 : 0);
  const combs = new Map(core.map((id) => {
    const ways = (kids.get(id) ?? []).map((k) => sideOf(id, k) || 1), how = { level: true, near: true, alone: new Set(ways).size < 2 };
    return [id, { down: comb(id, kids, stepSize, zc, sideOf, 1, 1, how), up: comb(id, kids, stepSize, zc, sideOf, -1, 1, how) }];
  }));
  /** How far each comb's level sits from the middle of the box, where there are two. */
  const portOff = (id) => {
    const { down, up } = combs.get(id);
    return down.items.length && up.items.length ? Math.min(stepSize(id).h / 4, zc.row / 2) : 0;
  };
  const block = (id) => {
    const s = stepSize(id), { down, up } = combs.get(id);
    if (!down.items.length && !up.items.length) return { w: s.w, h: s.h, lead: 0 };
    // A kid alone sits level with the box, half of it either side; a comb hangs clear of it on its own side.
    const off = portOff(id), over = ([hang, other]) => Math.max(s.h / 2, hang.items.length ? hang.h + off : 0, other.above ?? 0);
    const top = over([up, down]), foot = over([down, up]);
    return { w: s.w + combGap + Math.max(down.w, up.w), h: top + foot, lead: top - s.h / 2 };
  };
  const inCore = new Set(core), seen = new Set(), parts = [];
  for (const s of core) {
    if (seen.has(s)) continue;
    const list = [s];
    seen.add(s);
    for (let k = 0; k < list.length; k++) for (const w of a.get(list[k])) if (inCore.has(w) && !seen.has(w)) (seen.add(w), list.push(w));
    parts.push(list);
  }
  const orderKey = new Set(chains.map((c) => pair(c.a, c.b))), x = new Map(), y = new Map(), routes = new Map(), shelves = [];
  let threaded = 0;
  for (const list of parts) {
    const own = new Set(list), done = new Set(), part = [];
    // Links of this part, the order first, so it is what stays planar; each with whether it is the order.
    for (const w of [...every].sort((p, q) => Number(q.path !== undefined) - Number(p.path !== undefined))) {
      const k = pair(w.a, w.b);
      if (w.a !== w.b && own.has(w.a) && own.has(w.b) && !done.has(k)) (done.add(k), part.push([w.path ? w.a : w.b, w.path ? w.b : w.a, orderKey.has(k)]));
    }
    let drawn;
    if (list.length >= 3 && part.length >= 3) {
      for (const trial of list.length <= z.trial_most ? TRIALS.slice(0, z.trials) : TRIALS.slice(0, 1)) {
        try {
          const made = drawPart(list, part, block, stepSize, z, trial), cost = costOf(made, stepSize, z);
          if (!drawn || cost < drawn.cost) drawn = { ...made, cost };
        } catch (e) { console.warn?.(`The bars fell back: ${e.message}`); }
      }
      if (drawn) threaded += drawn.crossings;
    }
    if (!drawn) {
      let run = 0;
      drawn = { places: new Map(list.map((id) => { const p = [0, run]; run += block(id).h + z.row; return [id, p]; })), points: new Map(), crossings: 0 };
    }
    const xs = [...drawn.places].flatMap(([id, [px]]) => [px - block(id).w / 2, px + block(id).w / 2]), ys = [...drawn.places].flatMap(([id, [, py]]) => [py, py + block(id).h]);
    const wired = [...drawn.points.values()].flatMap((r) => r.points);
    const l = Math.min(...xs, ...wired.map((p) => p[0])), t = Math.min(...ys, ...wired.map((p) => p[1]));
    shelves.push({ drawn, l, t, w: Math.max(...xs, ...wired.map((p) => p[0])) - l, h: Math.max(...ys, ...wired.map((p) => p[1])) - t });
  }
  shelves.sort((p, q) => q.h - p.h || q.w - p.w);
  const area = shelves.reduce((s, c) => s + (c.w + gap) * (c.h + gap), 0), most = Math.max(shelves[0]?.w ?? 0, Math.sqrt(area * aspect));
  let sx = margin, sy = margin, row = 0;
  const parents = new Map();
  /** The item of the core a tree hangs on. */
  const holder = (id) => (parents.has(id) ? holder(parents.get(id)) : id);
  const note = (holder) => (kids.get(holder) ?? []).forEach((k) => (parents.set(k, holder), note(k)));
  for (const c of shelves) {
    if (sx > margin && sx + c.w > margin + most) ((sx = margin), (sy += row + gap), (row = 0));
    const dx = sx - c.l, dy = sy - c.t;
    for (const [id, [px, py]] of c.drawn.places) {
      const s = stepSize(id), { down, up } = combs.get(id), b = block(id), boxX = px - b.w / 2 + s.w / 2 + dx, boxY = py + b.lead + s.h / 2 + dy;
      x.set(id, boxX);
      y.set(id, boxY);
      note(id);
      const ax = px - b.w / 2 + s.w + combGap + (b.w - s.w - combGap) / 2 + dx, off = portOff(id);
      for (const [hang, way] of [[down, 1], [up, -1]]) {
        // Each leaves the box at a port of its own when there are two.
        const at = boxY + way * off, map = ([p, q]) => [ax + p, at + way * q];
        for (const it of hang.items) (x.set(it.id, map([it.x, it.y])[0]), y.set(it.id, map([it.x, it.y])[1]));
        for (const [item, points] of hang.wires) {
          const from = parents.get(item), line = points.map(map);
          routes.set(pair(from, item), { from, points: from === id ? [[boxX + s.w / 2, at], ...line.slice(line[0][0] === ax && line[0][1] === at ? 1 : 0)] : line });
        }
      }
    }
    for (const [k, r] of c.drawn.points) routes.set(k, { from: r.from, to: r.to, points: r.points.map(([p, q]) => [p + dx, q + dy]) });
    sx += c.w + gap;
    row = Math.max(row, c.h);
  }
  // Pull each box and wire tight, the topology kept: a box and what hangs on it move as one.
  const rigid = new Map(), moving = [];
  let settled = null, wired = null;
  for (const [id, c] of combs) {
    if (!x.has(id)) continue;
    const s = stepSize(id), b = block(id), left = x.get(id) - s.w / 2, top = y.get(id) - s.h / 2 - b.lead;
    rigid.set(id, { at: [left + b.w / 2, top + b.h / 2], size: [b.w, b.h], reach: [[-b.w / 2, -b.w / 2 + s.w], [-b.h / 2 + b.lead, -b.h / 2 + b.lead + s.h]], was: [left + b.w / 2, top + b.h / 2], hangs: [...c.down.items, ...c.up.items].map((it) => it.id) });
  }
  for (const r of routes.values()) if (r.to !== undefined && rigid.has(r.from) && rigid.has(r.to)) moving.push(Object.assign(r, { a: r.from, b: r.to, down: orderKey.has(pair(r.from, r.to)) }));
  if (moving.length && square(moving)) {
    settled = settle(rigid, moving, { gap: gap / 2, track: z.turn, ...zw, watch: watching, ...(moving.length > PULL_MOST && { rounds: 4, sweeps: 6 }) });
    // The parts have pulled in, so they are set again, closer.
    const sets = shelves.map((c) => {
      const ids = [...c.drawn.places.keys()].filter((id) => rigid.has(id)), rs = ids.map((id) => rigid.get(id));
      const own = new Set(ids), lines = moving.filter((w) => own.has(w.a));
      const xs = [...rs.flatMap((b) => [b.at[0] - b.size[0] / 2, b.at[0] + b.size[0] / 2]), ...lines.flatMap((w) => w.points.map((q) => q[0]))];
      const ys = [...rs.flatMap((b) => [b.at[1] - b.size[1] / 2, b.at[1] + b.size[1] / 2]), ...lines.flatMap((w) => w.points.map((q) => q[1]))];
      const [l, t] = [Math.min(...xs), Math.min(...ys)];
      return { rs, lines, l, t, w: Math.max(...xs) - l, h: Math.max(...ys) - t };
    }).filter((c) => c.rs.length).sort((p, q) => q.h - p.h || q.w - p.w);
    const room = sets.reduce((sum, c) => sum + (c.w + gap) * (c.h + gap), 0), wide = Math.max(sets[0]?.w ?? 0, Math.sqrt(room * aspect));
    let nx = margin, ny = margin, tall = 0;
    for (const c of sets) {
      if (nx > margin && nx + c.w > margin + wide) ((nx = margin), (ny += tall + gap), (tall = 0));
      const dx = nx - c.l, dy = ny - c.t;
      for (const b of c.rs) ((b.at[0] += dx), (b.at[1] += dy));
      for (const w of c.lines) w.points = w.points.map(([p, q]) => [p + dx, q + dy]);
      nx += c.w + gap;
      tall = Math.max(tall, c.h);
    }
    for (const [id, b] of rigid) {
      const dx = b.at[0] - b.was[0], dy = b.at[1] - b.was[1];
      for (const it of [id, ...b.hangs]) (x.set(it, x.get(it) + dx), y.set(it, y.get(it) + dy));
    }
    for (const [k, r] of routes) if (r.to === undefined) {
      const b = rigid.get(holder(r.from));
      r.points = r.points.map(([p, q]) => [p + b.at[0] - b.was[0], q + b.at[1] - b.was[1]]);
    }
    for (const [id, b] of rigid) b.pointed = nodes.get(id).shape === 'diamond';
    wired = reroute(rigid, moving, [...routes.values()].filter((r) => r.to === undefined).map((r) => r.points), { track: z.turn, room: z.room, run: z.run, ports: sizes.plane_reroute_ports, shorter: sizes.plane_reroute_shorter, rounds: sizes.plane_reroute_rounds });
  }
  const edge = (id, to) => {
    const s = stepSize(id), [px, py] = [x.get(id), y.get(id)], dx = to[0] - px, dy = to[1] - py, t = Math.min(dx ? s.w / 2 / Math.abs(dx) : Infinity, dy ? s.h / 2 / Math.abs(dy) : Infinity, 1);
    return [px + dx * t, py + dy * t];
  };
  for (const w of every) {
    const r = routes.get(pair(w.a, w.b));
    w.points = r ? (r.from === w.a ? r.points : [...r.points].reverse()) : [edge(w.a, [x.get(w.b), y.get(w.b)]), edge(w.b, [x.get(w.a), y.get(w.a)])];
    w.headAt = 'end';
  }
  const all = [...nodes.values()].filter((n) => x.has(n.id)), drawnPoints = every.flatMap((w) => w.points);
  const width = Math.max(0, ...all.map((n) => x.get(n.id) + n.w / 2), ...drawnPoints.map((p) => p[0])) + margin;
  const height = Math.max(0, ...all.map((n) => y.get(n.id) + n.h / 2), ...drawnPoints.map((p) => p[1])) + margin;
  const up = chains.filter((c) => y.get(c.a) > y.get(c.b)).length;
  last = { chains, ties, threaded, settled, wired, up };
  return { nodes, all, chains, ties, breaks: [], potential, x, y, width, height };
}
