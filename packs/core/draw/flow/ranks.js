// The plane with its rows set by the order: as the flow, no wire of the order can run up, and everything else goes to
// bringing crossings down. Trees of ties hang in combs beside their item (./combs.js), so they take no room in a row;
// what is left is laid out in rows (./rows.js), placed and wired as the flow's are (./layers.js, ./wires.js), each wire
// its own, then pulled tight with the crossings kept (./settle.js). Pure: an answer in, geometry out.

import { comb, peel } from './combs.js';
import { flatten, NEAR, ORDER } from './graph.js';
import { putByHand } from './hand.js';
import { placeRows } from './layers.js';
import { stepsOf } from './steps.js';
import { orderRows, rowsOf, thread } from './rows.js';
import { settle, square } from './settle.js';

/** Past this many wires the pull takes fewer rounds: a drawing that takes too long is stopped by the page. */
const PULL_MOST = 150;
/** What a tie along a row, and a row over its width, may cost: see drawPart. */
const FLATS = [6, 12, 20], CROWDS = [3, 8];
/** Starts of the search beside the walk along the links. */
const SHUFFLES = 6;

let last = null;
/** What the last layout drew, for the count in the key. */
export const latest = () => last;
const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const QUIET = new Set([NEAR, 'owned_by']);

/** Where each stands walking the order and its ties from the top: what is joined starts out side by side. */
function walked(ids, lines) {
  const next = new Map(ids.map((id) => [id, []])), seen = new Map();
  for (const l of lines) (next.get(l.from).push(l.to), next.get(l.to).push(l.from));
  const walk = (id) => {
    seen.set(id, seen.size);
    for (const w of next.get(id)) if (!seen.has(w)) walk(w);
  };
  for (const id of ids) if (!seen.has(id)) walk(id);
  return seen;
}

/** One connected part: laid out by rows. Answers with box places and each line's points, in the part's own frame. */
function drawPart(list, edges, ties, { nodes, block, gap, z, aspect, starts }) {
  const own = new Set(list), done = new Set(), lines = [];
  const add = (from, to, link, order) => {
    const k = pair(from, to);
    if (from === to || done.has(k) || !own.has(from) || !own.has(to)) return;
    done.add(k);
    lines.push({ order, link, from, to, weight: !order && QUIET.has(link.type) ? 1 : 2 });
  };
  for (const e of edges) add(e.a, e.b, e, true);
  for (const t of ties) add(t.a, t.b, t, false);
  const area = list.reduce((s, id) => s + (block(id).w + gap) * (block(id).h + z.LAYER_GAP), 0);
  const across = Math.sqrt(area * aspect), orders = lines.filter((l) => l.order).map((l) => ({ a: l.from, b: l.to })), rest = lines.filter((l) => !l.order).map((l) => ({ a: l.from, b: l.to, type: l.link.type }));
  // Waypoints stand between their ends to start with.
  const inLine = (place) => {
    const at = new Map(list.map((id) => [id, place(id) ?? 0]));
    for (const l of lines) l.path.forEach((id, k) => at.has(id) || at.set(id, at.get(l.from) + ((at.get(l.to) - at.get(l.from)) * k) / (l.path.length - 1)));
    return (id) => at.get(id);
  };
  // What a tie along a row should cost, and a crowded row, has no one answer: each pair is tried, and the rows kept that
  // cross least for the room they take.
  let best = null;
  for (const flat of FLATS) for (const crowd of CROWDS) {
    const row = rowsOf(list, orders, rest, { wide: (id) => block(id).w + gap, across, quiet: (t) => QUIET.has(t.type), flat, crowd });
    const t = thread(list, lines, row), scores = orderRows(t, starts(list, lines).map(inLine));
    const widest = Math.max(...t.layers.map((k) => k.reduce((s, id) => s + (t.waypoints.get(id)?.w ?? block(id).w) + gap, 0)));
    const cost = Math.min(...scores) * Math.max(1, widest / across);
    if (!best || cost < best.cost) best = { cost, row, layers: t.layers };
  }
  const { row } = best, t = thread(list, lines, row), scores = [best.cost];
  t.layers.splice(0, t.layers.length, ...best.layers);
  // A comb stands in its row just right of its item, as tall as it hangs.
  const laid = new Map(), x = new Map(), y = new Map();
  for (const id of list) laid.set(id, { ...nodes.get(id), layer: row.get(id) });
  for (const [id, n] of t.waypoints) laid.set(id, n);
  for (const id of list) {
    const b = block(id), s = nodes.get(id);
    if (b.w === s.w) continue;
    const side = `${id}:comb`;
    laid.set(side, { id: side, shape: 'box', w: b.w - s.w - gap, h: b.h, layer: row.get(id), lines: [] });
    for (const m of [t.up, t.down, t.upOrder, t.downOrder]) m.set(side, []);
    const k = t.layers[row.get(id)];
    k.splice(k.indexOf(id) + 1, 0, side);
  }
  const flows = (id) => t.upOrder.get(id)?.length > 0 || t.downOrder.get(id)?.length > 0;
  const drawn = placeRows({ lines, chosen: t, flows, nodes: laid, x, y, potential: new Set(), z });
  return { places: new Map(list.map((id) => [id, [x.get(id), y.get(id)]])), lines, scores, width: drawn.width, height: drawn.height };
}

/** For a test or a bench: told how each pass went. */
let watching = null;
export const watch = (fn) => (watching = fn);

// As ./bars.js, where a step was put by hand is not read here yet.
export function layout({ items: given, links: told = [], undrawn = [], placed = {}, measure, sizes, aspect = 1.6 }) {
  const { items, links } = flatten({ items: given, links: told, undrawn });
  const { nodes, edges, potential } = stepsOf({ items, links, measure, sizes });
  const margin = sizes.flow_margin, gap = sizes.flow_node_gap, zc = { row: gap / 4, col: gap };
  const z = { LAYER_GAP: sizes.flow_layer_gap, NODE_GAP: gap, BOX_H: sizes.flow_box_height, TRACK: sizes.flow_track, SLOT: sizes.flow_slot, LEAD_OUT: sizes.flow_lead_out, LEAD_IN: sizes.flow_lead_in, EXACT: true, HEADS: true };
  const ties = links.filter((l) => l.type !== ORDER).map((l) => ({ a: l.from, b: l.to, type: l.type, ...(l.pending && { pending: l.pending }) }));
  const chains = edges.map((e) => ({ ...e, key: `${e.a} ${e.b}`, path: [e.a, e.b], dashed: potential.has(e.b) }));
  const every = [...chains, ...ties], stepSize = (id) => nodes.get(id);
  // A tree of ties peels off into a comb. A step the order reaches stays in the rows: a comb cannot say which way it runs.
  const a = new Map([...nodes.keys()].map((id) => [id, new Set()])), ordered = new Set();
  for (const w of every) if (w.a !== w.b && a.has(w.a) && a.has(w.b)) (a.get(w.a).add(w.b), a.get(w.b).add(w.a));
  for (const c of chains) (ordered.add(c.a), ordered.add(c.b));
  const { kids, core: peeled } = peel(a, ordered);
  const core = peeled;
  const combs = new Map(core.map((id) => [id, comb(id, kids, stepSize, zc)]));
  const block = (id) => {
    const s = stepSize(id), c = combs.get(id);
    return c?.items.length ? { w: s.w + gap + c.w, h: Math.max(s.h, s.h / 2 + c.h) } : { w: s.w, h: s.h };
  };
  const inCore = new Set(core), seen = new Set(), parts = [];
  for (const s of core) {
    if (seen.has(s)) continue;
    const list = [s];
    seen.add(s);
    for (let k = 0; k < list.length; k++) for (const w of a.get(list[k])) if (inCore.has(w) && !seen.has(w)) (seen.add(w), list.push(w));
    parts.push(list);
  }
  const starts = (list, lines) => {
    const walkedAt = walked(list, lines), shuffled = Array.from({ length: SHUFFLES }, (_, k) => {
      let seed = 7 + k;
      const at = new Map(list.map((id) => [id, (seed = (seed * 1664525 + 1013904223) % 4294967296)]));
      return (id) => at.get(id);
    });
    return [(id) => walkedAt.get(id), ...shuffled];
  };
  const x = new Map(), y = new Map(), routes = new Map(), shelves = [];
  let rowsScore = 0;
  for (const list of parts) {
    const drawn = drawPart(list, chains, ties, { nodes, block, gap, z, aspect, starts });
    rowsScore += Math.min(...drawn.scores);
    shelves.push(drawn);
  }
  shelves.sort((p, q) => q.height - p.height || q.width - p.width);
  const area = shelves.reduce((s, c) => s + (c.width + gap) * (c.height + gap), 0), most = Math.max(shelves[0]?.width ?? 0, Math.sqrt(area * aspect));
  let sx = margin, sy = margin, row = 0;
  const parents = new Map();
  /** The item of the core a tree hangs on. */
  const holder = (id) => (parents.has(id) ? holder(parents.get(id)) : id);
  const note = (id) => (kids.get(id) ?? []).forEach((k) => (parents.set(k, id), note(k)));
  for (const c of shelves) {
    if (sx > margin && sx + c.width > margin + most) ((sx = margin), (sy += row + gap), (row = 0));
    for (const [id, [px, py]] of c.places) {
      const s = stepSize(id), hang = combs.get(id), boxX = px + sx, boxY = py + sy;
      x.set(id, boxX);
      y.set(id, boxY);
      if (!hang?.items.length) continue;
      note(id);
      const ax = boxX + s.w / 2 + gap + hang.w / 2, map = ([p, q]) => [ax + p, boxY + q];
      for (const it of hang.items) (x.set(it.id, map([it.x, it.y])[0]), y.set(it.id, map([it.x, it.y])[1]));
      for (const [item, points] of hang.wires) {
        const from = parents.get(item), line = points.map(map);
        routes.set(pair(from, item), { from, points: from === id ? [[boxX + s.w / 2, boxY], [ax, boxY], ...line.slice(1)] : line });
      }
    }
    for (const l of c.lines) routes.set(pair(l.from, l.to), { from: l.from, to: l.to, points: l.points.map(([p, q]) => [p + sx, q + sy]) });
    sx += c.width + gap;
    row = Math.max(row, c.height);
  }
  // Pull each box and wire tight, the topology kept: a box and what hangs on it move as one.
  const rigid = new Map(), moving = [];
  let settled = null;
  for (const [id, c] of combs) {
    if (!x.has(id)) continue;
    const s = stepSize(id), b = block(id), left = x.get(id) - s.w / 2, top = y.get(id) - s.h / 2;
    rigid.set(id, { at: [left + b.w / 2, top + b.h / 2], size: [b.w, b.h], reach: [[-b.w / 2, -b.w / 2 + s.w], [-b.h / 2, -b.h / 2 + s.h]], was: [left + b.w / 2, top + b.h / 2], hangs: c.items.map((it) => it.id) });
  }
  for (const r of routes.values()) if (r.to !== undefined && rigid.has(r.from) && rigid.has(r.to)) moving.push(Object.assign(r, { a: r.from, b: r.to }));
  if (moving.length && square(moving)) {
    settled = settle(rigid, moving, { gap: gap / 2, track: gap / 3, watch: watching, ...(moving.length > PULL_MOST && { rounds: 4, sweeps: 6 }) });
    // The parts have pulled in, so they are set again, closer.
    const sets = shelves.map((c) => {
      const ids = [...c.places.keys()].filter((id) => rigid.has(id)), rs = ids.map((id) => rigid.get(id));
      const own = new Set(ids), wired = moving.filter((w) => own.has(w.a));
      const xs = [...rs.flatMap((b) => [b.at[0] - b.size[0] / 2, b.at[0] + b.size[0] / 2]), ...wired.flatMap((w) => w.points.map((q) => q[0]))];
      const ys = [...rs.flatMap((b) => [b.at[1] - b.size[1] / 2, b.at[1] + b.size[1] / 2]), ...wired.flatMap((w) => w.points.map((q) => q[1]))];
      const [l, t] = [Math.min(...xs), Math.min(...ys)];
      return { rs, wired, l, t, w: Math.max(...xs) - l, h: Math.max(...ys) - t };
    }).filter((c) => c.rs.length).sort((p, q) => q.h - p.h || q.w - p.w);
    const room = sets.reduce((sum, c) => sum + (c.w + gap) * (c.h + gap), 0), wide = Math.max(sets[0]?.w ?? 0, Math.sqrt(room * aspect));
    let nx = margin, ny = margin, tall = 0;
    for (const c of sets) {
      if (nx > margin && nx + c.w > margin + wide) ((nx = margin), (ny += tall + gap), (tall = 0));
      const dx = nx - c.l, dy = ny - c.t;
      for (const b of c.rs) ((b.at[0] += dx), (b.at[1] += dy));
      for (const w of c.wired) w.points = w.points.map(([p, q]) => [p + dx, q + dy]);
      nx += c.w + gap;
      tall = Math.max(tall, c.h);
    }
    for (const [id, b] of rigid) {
      const dx = b.at[0] - b.was[0], dy = b.at[1] - b.was[1];
      for (const it of [id, ...b.hangs]) (x.set(it, x.get(it) + dx), y.set(it, y.get(it) + dy));
    }
    for (const r of routes.values()) if (r.to === undefined) {
      const b = rigid.get(holder(r.from));
      r.points = r.points.map(([p, q]) => [p + b.at[0] - b.was[0], q + b.at[1] - b.was[1]]);
    }
  }
  putByHand({ placed, nodes, x, y, every, routes, rigid, holder, lead: sizes.flow_lead_out, wiring: { track: sizes.plane_wire_gap, room: sizes.plane_wire_room, run: sizes.plane_port_run, gap: sizes.plane_wire_gap, corner: sizes.plane_port_corner, ports: sizes.plane_reroute_ports } });
  const edge = (id, to) => {
    const s = stepSize(id), [px, py] = [x.get(id), y.get(id)], dx = to[0] - px, dy = to[1] - py, t = Math.min(dx ? s.w / 2 / Math.abs(dx) : Infinity, dy ? s.h / 2 / Math.abs(dy) : Infinity, 1);
    return [px + dx * t, py + dy * t];
  };
  for (const w of every) {
    const r = routes.get(pair(w.a, w.b));
    w.points = r ? (r.from === w.a ? r.points : [...r.points].reverse()) : [edge(w.a, [x.get(w.b), y.get(w.b)]), edge(w.b, [x.get(w.a), y.get(w.a)])];
    w.headAt = 'end';
  }
  for (const c of chains) c.up = y.get(c.a) > y.get(c.b);
  const all = [...nodes.values()].filter((n) => x.has(n.id)), drawnPoints = every.flatMap((w) => w.points);
  const width = Math.max(0, ...all.map((n) => x.get(n.id) + n.w / 2), ...drawnPoints.map((p) => p[0])) + margin;
  const height = Math.max(0, ...all.map((n) => y.get(n.id) + n.h / 2), ...drawnPoints.map((p) => p[1])) + margin;
  last = { chains, ties, settled, rowsScore, width, height, up: chains.filter((c) => c.up).length };
  return { nodes, all, chains, ties, breaks: [], potential, x, y, width, height };
}
