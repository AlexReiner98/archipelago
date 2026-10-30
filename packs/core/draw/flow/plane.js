// A lens answer on one plane, placed by the shape of its graph: trees hang in combs (./combs.js), items of the same two
// sit in blocks, the knot left is placed from its heaviest planar part (./planar.js) and what still crosses is moved
// (./knot.js). It answers as the flow's layout does, every link a line of points, so the flow's picture draws it.
// Room comes from scale first, which keeps every crossing as it is, and only then are boxes nudged. A step put by hand
// stays where it was put, its wires straight. Pure: an answer in, geometry out.

import { comb, drawBlock, peel, twins } from './combs.js';
import { acyclic, flatten, ORDER, QUIET } from './graph.js';
import { chainsOf, stress, untangle } from './knot.js';
import { lines } from './lines.js';
import { planarPlaces } from './planar.js';

/** The knot goes to the planar calculation up to this many edges: past it, each test of an edge costs too much. */
const PLANAR_MOST = 400;
/** How much work the local search may do, in wires compared. */
const BUDGET = 1e7;
/** A comb taller or wider than this hangs at the foot of the picture, on one trunk. */
const PARK = 900;
const MOST_SCALE = 2, TOUCHING = 0.03;

let last = null;
/** What the last layout drew, for the count in the key. */
export const latest = () => last;

const need = (set, name) => {
  if (typeof set?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every one the plane lays out by`);
  return set[name];
};
const pairOf = (u, v) => (u < v ? `${u}|${v}` : `${v}|${u}`);

/** Each item a step with its size, as the flow sizes them; a choice nothing follows yet is a step of its own. */
function stepsOf({ items, links, measure, sizes }) {
  const [MAX_TEXT, TEXT, STUB_TEXT, DIAMOND_PAD, DIAMOND_H, END_PAD, END_H, BOX_PAD, BOX_H, SHEET_H] = ['flow_max_text', 'flow_text', 'flow_stub_text', 'flow_diamond_pad', 'flow_diamond_height', 'flow_end_pad', 'flow_end_height', 'flow_box_pad', 'flow_box_height', 'flow_sheet_height'].map((n) => need(sizes, n));
  const shapeOf = (i) => (i.kind === 'question' ? 'diamond' : i.kind === 'occurrence' ? 'pill' : i.kind === 'record' ? 'sheet' : 'box');
  const nodes = new Map();
  for (const i of [...items].sort((a, b) => (a.place ?? 0) - (b.place ?? 0))) nodes.set(i.id, { id: i.id, item: i, shape: shapeOf(i) });
  const seen = new Set();
  let edges = [];
  for (const l of links) if (l.type === ORDER && !seen.has(`${l.to} ${l.from}`)) (seen.add(`${l.to} ${l.from}`), edges.push({ a: l.to, b: l.from, ...(l.says && { says: l.says }), ...(l.pending && { pending: l.pending }) }));
  edges = acyclic(edges, [...nodes.keys()]);
  const open = [...nodes.values()].filter((n) => n.shape === 'diamond' && n.item.open);
  for (const d of open) {
    const taken = new Set(edges.filter((e) => e.a === d.id).map((e) => e.says));
    (Array.isArray(d.item.choices) ? d.item.choices : []).forEach((option, k) => {
      if (taken.has(option)) return;
      const id = `${d.id}:${k}`;
      nodes.set(id, { id, stub: true, shape: 'end', item: { id: d.id, title: option, open: true, status: 'a scenario', state: QUIET } });
      edges.push({ a: d.id, b: id, says: option });
    });
  }
  const after = new Map();
  for (const e of edges) (after.get(e.a) ?? after.set(e.a, []).get(e.a)).push(e.b);
  const potential = new Set();
  const markOn = (id) => (after.get(id) ?? []).forEach((v) => potential.has(v) || (potential.add(v), markOn(v)));
  open.forEach((d) => markOn(d.id));
  const LINE = sizes.flow_line_height ?? TEXT * 1.25;
  for (const n of nodes.values()) {
    const px = n.stub ? STUB_TEXT : TEXT;
    n.lines = n.shape === 'end' ? [n.item.title] : lines(n.item.title, MAX_TEXT, (t) => measure(t, px));
    n.line = LINE;
    const text = Math.min(n.lines.reduce((s, t) => Math.max(s, measure(t, px)), 0), MAX_TEXT), more = (n.lines.length - 1) * LINE;
    if (n.shape === 'diamond') [n.w, n.h] = [text + DIAMOND_PAD, DIAMOND_H + more];
    else if (n.shape === 'end') [n.w, n.h] = [text + END_PAD, END_H];
    else [n.w, n.h] = [text + BOX_PAD, (n.shape === 'sheet' ? SHEET_H : BOX_H) + more];
  }
  return { nodes, edges, potential };
}

/** Where a straight wire from the middle of a box of size `s` at `from` toward `to` leaves it. */
const leaving = (from, to, s) => {
  const dx = to[0] - from[0], dy = to[1] - from[1], t = Math.min(dx ? s.w / 2 / Math.abs(dx) : Infinity, dy ? s.h / 2 / Math.abs(dy) : Infinity, 1);
  return [from[0] + dx * t, from[1] + dy * t];
};

export function layout({ items: given, links: told = [], undrawn = [], placed = {}, measure, sizes, aspect = 1.6 }) {
  const { items, links } = flatten({ items: given, links: told, undrawn });
  const { nodes, edges, potential } = stepsOf({ items, links, measure, sizes });
  const margin = need(sizes, 'flow_margin'), gap = need(sizes, 'flow_node_gap');
  const z = { row: gap / 4, col: gap, unit: need(sizes, 'flow_layer_gap') + gap };
  const ties = links.filter((l) => l.type !== ORDER).map((l) => ({ a: l.from, b: l.to, type: l.type, ...(l.pending && { pending: l.pending }) }));
  const chains = edges.map((e) => ({ ...e, key: `${e.a} ${e.b}`, path: [e.a, e.b], dashed: potential.has(e.b) }));
  const every = [...chains, ...ties], stepSize = (id) => nodes.get(id);
  // The graph, one edge for each two tied; a link that names what is not drawn draws nothing.
  const a = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const w of every) if (w.a !== w.b && a.has(w.a) && a.has(w.b)) (a.get(w.a).add(w.b), a.get(w.b).add(w.a));
  const { kids, core: peeled } = peel(a);
  const blocks = twins(a, kids, peeled, stepSize, z), member = new Map();
  for (const [id, b] of blocks) {
    for (const item of b.list) {
      member.set(item, id);
      for (const w of a.get(item)) a.get(w).delete(item);
      a.delete(item);
    }
    a.set(id, new Set([b.u, b.v]));
    a.get(b.u).add(id);
    a.get(b.v).add(id);
  }
  const core = [...peeled.filter((id) => !member.has(id)), ...blocks.keys()];
  const size = (id) => blocks.get(id) ?? stepSize(id);
  const combs = new Map(core.map((id) => [id, comb(id, kids, stepSize, z)]));
  const parked = (c) => Math.max(c.w, c.h) > PARK;
  const reach = (id) => {
    const s = size(id), c = combs.get(id);
    return Math.hypot(s.w, s.h) / 2 + (c?.items.length && !parked(c) ? 0.4 * Math.max(c.w, c.h) : 0);
  };
  const at = new Map();
  const rect = (id) => {
    const c = combs.get(id), s = size(id), [x, y] = at.get(id), hw = s.w / 2, hh = s.h / 2;
    if (!c.items.length || parked(c)) return { id, l: x - hw, r: x + hw, t: y - hh, b: y + hh };
    const w = Math.max(hw, c.w / 2 + z.col);
    if (c.dir === 'up') return { id, l: x - w, r: x + w, t: y - hh - c.h, b: y + hh };
    if (c.dir === 'right') return { id, l: x - hw, r: x + hw + 2 * w + z.col, t: y - Math.max(hh, c.h / 2), b: y + Math.max(hh, c.h / 2) };
    if (c.dir === 'left') return { id, l: x - hw - 2 * w - z.col, r: x + hw, t: y - Math.max(hh, c.h / 2), b: y + Math.max(hh, c.h / 2) };
    return { id, l: x - w, r: x + w, t: y - hh, b: y + hh + c.h };
  };
  const face = (id) => {
    const c = combs.get(id);
    if (!c.items.length) return;
    const [x, y] = at.get(id), free = { down: Infinity, up: Infinity, right: Infinity, left: Infinity }, angle = { down: Math.PI / 2, up: -Math.PI / 2, right: 0, left: Math.PI };
    for (const w of a.get(id)) {
      if (!combs.has(w)) continue;
      const th = Math.atan2(at.get(w)[1] - y, at.get(w)[0] - x);
      for (const k in free) free[k] = Math.min(free[k], Math.abs(Math.atan2(Math.sin(th - angle[k]), Math.cos(th - angle[k]))));
    }
    c.dir = Object.keys(free).sort((p, q) => free[q] - free[p])[0];
  };
  const touching = (list) => {
    const rs = list.map(rect).sort((p, q) => p.l - q.l);
    let n = 0;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length && rs[j].l < rs[i].r + z.col / 2; j++) if (rs[j].t < rs[i].b + z.col / 2 && rs[i].t < rs[j].b + z.col / 2) n++;
    return n;
  };
  const apart = (list) => {
    for (let round = 0; round < 60; round++) {
      let moved = 0;
      const rs = list.map(rect).sort((p, q) => p.l - q.l);
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length && rs[j].l < rs[i].r + z.col / 2; j++) {
        const [p, q] = [rs[i], rs[j]], ox = Math.min(p.r, q.r) - Math.max(p.l, q.l) + z.col / 2, oy = Math.min(p.b, q.b) - Math.max(p.t, q.t) + z.col / 2;
        if (ox <= 0 || oy <= 0) continue;
        moved++;
        const [pi, pj] = [at.get(p.id), at.get(q.id)];
        if (ox < oy) { const s = ((p.l + p.r < q.l + q.r ? -1 : 1) * ox) / 2 * 1.1; pi[0] += s; pj[0] -= s; }
        else { const s = ((p.t + p.b < q.t + q.b ? -1 : 1) * oy) / 2 * 1.1; pi[1] += s; pj[1] -= s; }
      }
      if (!moved) return;
    }
  };
  // Each part of the graph alone, then the parts in rows, the tallest first.
  const seen = new Set(), parts = [];
  for (const s of core) {
    if (seen.has(s)) continue;
    const list = [s];
    seen.add(s);
    for (let k = 0; k < list.length; k++) for (const w of a.get(list[k])) if (combs.has(w) && !seen.has(w)) (seen.add(w), list.push(w));
    parts.push(list);
  }
  const shelves = [];
  for (const list of parts) {
    if (list.length > 1) {
      const { knots, isKnot, chains: runs } = chainsOf(list, a), near = new Map(knots.map((k) => [k, new Set()])), bundles = new Map();
      for (const c of runs) {
        if (c.u === c.v) continue;
        const k = pairOf(c.u, c.v);
        if (!bundles.has(k)) (bundles.set(k, []), near.get(c.u).add(c.v), near.get(c.v).add(c.u));
        bundles.get(k).push(c);
      }
      const weight = (u, v) => bundles.get(pairOf(u, v))?.length ?? 1;
      const weighted = [...bundles.values()].map((cs) => [cs[0].u, cs[0].v, cs.length]);
      if (weighted.length && weighted.length <= PLANAR_MOST) planarPlaces({ knots, weighted, reach, at, unit: z.unit });
      else stress(list, a, reach, at, z.unit, isKnot);
      untangle(knots, near, weighted, weight, at, reach, z.unit, BUDGET);
      for (const cs of bundles.values()) cs.forEach((c, i) => {
        const p = at.get(c.u), q = at.get(c.v), L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, off = (i - (cs.length - 1) / 2) * gap;
        c.inner.forEach((id, k) => {
          const t = (k + 1) / (c.inner.length + 1), bow = off * 4 * t * (1 - t);
          at.set(id, [p[0] + (q[0] - p[0]) * t - ((q[1] - p[1]) / L) * bow, p[1] + (q[1] - p[1]) * t + ((q[0] - p[0]) / L) * bow]);
        });
      });
      for (const c of runs) if (c.u === c.v) c.inner.forEach((id, k) => {
        const p = at.get(c.u), th = (2 * Math.PI * (k + 1)) / (c.inner.length + 1);
        at.set(id, [p[0] + z.unit * (1 - Math.cos(th)), p[1] + z.unit * Math.sin(th)]);
      });
    } else at.set(list[0], [0, 0]);
    list.forEach(face);
    const home = new Map(list.map((id) => [id, [...at.get(id)]]));
    const scaled = (f) => { for (const [id, p] of home) { const q = at.get(id); q[0] = p[0] * f; q[1] = p[1] * f; } };
    let lo = 0.2, hi = MOST_SCALE;
    for (let k = 0; k < 9; k++) { const mid = Math.sqrt(lo * hi); scaled(mid); if (touching(list) > list.length * TOUCHING) lo = mid; else hi = mid; }
    scaled(hi);
    apart(list);
    const rs = list.map(rect), big = list.filter((id) => parked(combs.get(id))).sort((p, q) => at.get(p)[0] - at.get(q)[0]);
    let foot = Math.max(...rs.map((r) => r.b)) + 2 * z.col, run = Math.min(...rs.map((r) => r.l)), tall = 0;
    for (const id of big) {
      const c = combs.get(id);
      c.at = [run + c.w / 2, foot];
      run += c.w + 2 * z.col;
      tall = Math.max(tall, c.h);
    }
    if (big.length) rs.push({ l: rs[0].l, r: run, t: foot, b: foot + tall });
    const [l, t] = [Math.min(...rs.map((r) => r.l)), Math.min(...rs.map((r) => r.t))];
    shelves.push({ big, list, l, t, w: Math.max(...rs.map((r) => r.r)) - l, h: Math.max(...rs.map((r) => r.b)) - t });
  }
  shelves.sort((p, q) => q.h - p.h || q.w - p.w);
  const area = shelves.reduce((s, c) => s + (c.w + z.col) * (c.h + z.col), 0), most = Math.max(shelves[0]?.w ?? 0, Math.sqrt(area * aspect));
  let sx = margin, sy = margin, row = 0;
  for (const c of shelves) {
    if (sx > margin && sx + c.w > margin + most) ((sx = margin), (sy += row + z.col), (row = 0));
    for (const id of c.list) { const p = at.get(id); p[0] += sx - c.l; p[1] += sy - c.t; }
    for (const id of c.big) { const q = combs.get(id).at; q[0] += sx - c.l; q[1] += sy - c.t; }
    sx += c.w + z.col;
    row = Math.max(row, c.h);
  }
  // The places, and each link's line from what holds it to what it holds.
  const x = new Map(), y = new Map(), held = new Map(), railed = new Map();
  const set = (id, [px, py]) => (x.set(id, px), y.set(id, py));
  for (const id of core) {
    const c = combs.get(id), s = size(id), [cx, cy] = at.get(id);
    if (!blocks.has(id)) set(id, [cx, cy]);
    if (!c.items.length) continue;
    let map;
    if (parked(c)) map = ([px, py]) => [c.at[0] + px, c.at[1] + py];
    else if (c.dir === 'up') map = ([px, py]) => [cx + px, cy - s.h / 2 - py];
    else if (c.dir === 'right') map = ([px, py]) => [cx + s.w / 2 + 2 * z.col + c.w / 2 + px, cy - c.h / 2 + py];
    else if (c.dir === 'left') map = ([px, py]) => [cx - s.w / 2 - 2 * z.col - c.w / 2 + px, cy - c.h / 2 + py];
    else map = ([px, py]) => [cx + px, cy + s.h / 2 + py];
    for (const it of c.items) set(it.id, map([it.x, it.y]));
    const parent = new Map();
    const note = (holder) => (kids.get(holder) ?? []).forEach((k) => (parent.set(k, holder), note(k)));
    note(id);
    for (const [item, points] of c.wires) {
      const from = parent.get(item), drawn = points.map(map);
      const start = from === id ? (parked(c) ? [cx, cy + s.h / 2] : c.dir === 'left' || c.dir === 'right' ? [cx + (Math.sign(drawn[0][0] - cx) * s.w) / 2, cy] : drawn[0]) : drawn[0];
      held.set(pairOf(from, item), { from, points: from === id && start !== drawn[0] ? [start, ...drawn] : drawn });
    }
  }
  for (const [id, b] of blocks) {
    const [cx, cy] = at.get(id), left = at.get(b.u)[0] <= at.get(b.v)[0], d = drawBlock(b, cx, cy, stepSize, z);
    for (const [item, p] of d.places) set(item, p);
    for (const item of b.list) {
      railed.set(pairOf(b.u, item), { from: b.u, points: left ? d.first.get(item) : d.second.get(item) });
      railed.set(pairOf(b.v, item), { from: b.v, points: left ? d.second.get(item) : d.first.get(item) });
    }
  }
  const hand = new Set(Object.keys(placed).filter((id) => nodes.has(id) && Array.isArray(placed[id])));
  for (const id of hand) set(id, [Number(placed[id][0]), Number(placed[id][1])]);
  const middle = (id) => [x.get(id), y.get(id)];
  for (const w of every) {
    const key = pairOf(w.a, w.b), run = !hand.has(w.a) && !hand.has(w.b) ? held.get(key) ?? railed.get(key) : null;
    let points;
    if (run && (held.has(key) || railed.has(key))) {
      const lead = railed.has(key) ? leaving(middle(run.from), run.points[0], stepSize(run.from)) : null;
      points = lead ? [lead, ...run.points] : run.points;
      if (run.from !== w.a) points = [...points].reverse();
    } else points = [leaving(middle(w.a), middle(w.b), stepSize(w.a)), leaving(middle(w.b), middle(w.a), stepSize(w.b))];
    w.points = points;
    w.headAt = 'end';
  }
  const all = [...nodes.values()].filter((n) => x.has(n.id));
  const drawn = every.flatMap((w) => w.points);
  const width = Math.max(...all.map((n) => x.get(n.id) + n.w / 2), ...drawn.map((p) => p[0])) + margin;
  const height = Math.max(...all.map((n) => y.get(n.id) + n.h / 2), ...drawn.map((p) => p[1])) + margin;
  last = { chains, ties };
  return { nodes, all, chains, ties, breaks: [], potential, x, y, width, height };
}
