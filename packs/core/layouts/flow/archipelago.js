// A picture of more than one island, set out as an archipelago (task e_auw7hb3v; one wiring system, inside islands and
// out: design e_87x2us2b, the owner, 6 Nov 2026). Every level is laid out by the flow's own layers: each island alone to
// its frame (its steps, its name over them, its legend beside them), then the sea, where each island is one box of its
// frame's size and each link between two islands a link, twins kept apart (settled e_c7ky6vys, e_bftbg2w3). The side of
// the island each sea wire meets is then a port (./ports.js), and each island is wired again to its ports. A link across
// is three ordinary wires joined at two ports: inside one island, across the sea, inside the other. The sea's wires are set
// again round the ports by the one solve, each naming what crosses on a box of its own that takes room as any box does.
// What lives on no island (a person) is a group of its own, with no shore. Layer: metrics. Pure: the answer and a layout
// in, one model of the whole picture out.

import { frameOf, keeps, SIDES } from './ports.js';
import { shape } from './shape.js';
import { settle } from './solve.js';

/** The islands an answer's items live on, in the order they come. */
export const islandsOf = (items) => [...new Set(items.map((i) => i.island).filter(Boolean))];

/** Each island's items laid out alone by `run` (the flow's layout), and the links that join two of them. */
export function islandModels({ items, links, run }) {
  const where = new Map(items.map((i) => [i.id, i.island ?? null]));
  const ids = [...islandsOf(items), ...(items.some((i) => !i.island) ? [null] : [])];
  const groups = ids.map((id) => {
    const own = items.filter((i) => where.get(i.id) === id), set = new Set(own.map((i) => i.id)), inner = links.filter((l) => set.has(l.from) && set.has(l.to));
    return { id, items: own, links: inner, model: run({ items: own, links: inner }) };
  });
  const cross = links.filter((l) => where.has(l.from) && where.has(l.to) && where.get(l.from) !== where.get(l.to));
  return { groups, cross, where, run };
}

/** Entries of the given widths set out in lines no wider than `room`: each one's place, and the band's size. */
function band(widths, room, gap, row) {
  const at = [];
  let x = 0, y = 0, wide = 0;
  for (const w of widths) {
    if (x > 0 && x + w > room) (x = 0), (y += row);
    at.push([x, y]);
    x += w + gap;
    wide = Math.max(wide, x - gap);
  }
  return { at, w: wide, h: widths.length ? y + row : 0 };
}

/** The sea's name for a group: what lives on no island is a box too. */
const seaId = (id) => id ?? 'none~';

/** Which side of `box` (its middle and size) the point `p` stands on, and how far along that side, as a share of it. */
function sideOf(box, p) {
  const [cx, cy, w, h] = box, d = { top: Math.abs(p[1] - (cy - h / 2)), bottom: Math.abs(p[1] - (cy + h / 2)), left: Math.abs(p[0] - (cx - w / 2)), right: Math.abs(p[0] - (cx + w / 2)) };
  const side = Object.keys(d).reduce((s, k) => (d[k] < d[s] ? k : s), 'top'), along = 1 - SIDES[side][0];
  return { side, share: Math.min(1, Math.max(0, (p[along] - (along ? cy - h / 2 : cx - w / 2)) / (along ? h : w))) };
}

/**
 * A wire's way from a port at `at` on `side` of an island's `frame` to `to`, where the sea's wire meets the island's box,
 * `ring` out from the frame: out of the port across its side, then round the island in its own margin of sea, the
 * shorter way, to the point nearest `to`, and out to it. The sea's own route beyond is kept as the sea laid it.
 */
function inMargin(at, side, frame, ring, to) {
  const r = { l: frame.l - ring, t: frame.t - ring, r: frame.r + ring, b: frame.b + ring };
  const order = ['top', 'right', 'bottom', 'left'], corner = { top: [r.r, r.t], right: [r.r, r.b], bottom: [r.l, r.b], left: [r.l, r.t] };
  const onRing = (s, p) => (s === 'top' ? [p[0], r.t] : s === 'bottom' ? [p[0], r.b] : s === 'left' ? [r.l, p[1]] : [r.r, p[1]]);
  const near = { top: Math.abs(to[1] - r.t), bottom: Math.abs(to[1] - r.b), left: Math.abs(to[0] - r.l), right: Math.abs(to[0] - r.r) };
  const end = Object.keys(near).reduce((s, k) => (near[k] < near[s] ? k : s), 'top');
  const N = order.length, from = order.indexOf(side), steps = (order.indexOf(end) - from + N) % N, way = steps <= N / 2 ? 1 : -1;
  const path = [at, onRing(side, at)];
  // Clockwise each side ends at its corner; the other way each starts at the previous side's.
  for (let k = 0, s = from; k < (way > 0 ? steps : N - steps); k++, s = (s + way + N) % N) path.push(corner[order[way > 0 ? s : (s + N - 1) % N]]);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  path.push(onRing(end, [clamp(to[0], r.l, r.r), clamp(to[1], r.t, r.b)]), to);
  return path;
}

/** A sea wire from its sketch at sea, each end brought from its port round its island to where the sketch meets it. */
function onPorts(points, ends, ring) {
  // Each from its port's outer edge: its middle stands on the island's side.
  const outer = (e) => { const [axis, out] = SIDES[e.side], p = [...e.at]; p[axis] += (out * e.size[axis]) / 2; return p; };
  const [a, b] = ends.map((e, k) => inMargin(outer(e), e.side, e.frame, ring, k ? points.at(-1) : points[0]));
  return [...a, ...points.slice(1, -1), ...[...b].reverse()];
}

/**
 * The whole picture: each group's model moved to its place, merged into one model as the flow's layout answers, with the
 * links between islands as ties (each with its `gates`, its ports where it crosses a shore, `sea`: its line from the
 * reader's gate to the finding's, and `label`: the box that names what crosses), and `islands`: each one's frame as its
 * land, where its name and each entry of its legend go. `legends` gives each island's entries' widths, `names` how wide its
 * name is, and `labels` how wide the box naming what a link crosses with is.
 */
export function compose({ groups, cross, where, run }, { legends, names = new Map(), labels = () => 0, sizes }) {
  const z = (name) => sizes[`flow_island_${name}`];
  const [PAD, NAME, SEA, GAP, ROW, PORT, GATE] = ['pad', 'name_room', 'sea', 'legend_gap', 'legend_row', 'port', 'gate_height'].map(z);
  const M = sizes.flow_margin;
  // The first pass: each island alone, to its frame.
  const blocks = groups.map((g) => {
    const shore = g.id !== null, widths = shore ? legends.get(g.id) ?? [] : [], legend = band(widths, Math.max(0, ...widths), GAP, ROW);
    const raw = g.model.raw;
    const framed = frameOf(raw, { name: shore ? names.get(g.id) ?? 0 : 0, legend, pad: PAD, room: NAME, gap: GAP });
    return { ...g, shore, legend, raw, ...framed, first: framed };
  });
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const islandOf = (id) => where.get(id) ?? null;
  const reads = cross.filter((l) => byId.get(islandOf(l.from))?.raw.x.has(l.from) && byId.get(islandOf(l.to))?.raw.x.has(l.to));
  // The sea: each island a box of its frame and a sea round it, each link between two a link of its own.
  // Each side's margin of sea: half the sea, how far its ports reach out, and a wire's room for each wire that leaves by it.
  const margin = (b) => { const m = { top: SEA / 2, bottom: SEA / 2, left: SEA / 2, right: SEA / 2 }; for (const [side, n] of b.leaving ?? []) m[side] += n * blocks[0].raw.z.turn + (b.reach.get(side) ?? 0); return m; };
  const size = (b) => { const m = margin(b); return [b.frame.r - b.frame.l + m.left + m.right, b.frame.b - b.frame.t + m.top + m.bottom]; };
  const first = (b) => b.items.map((i) => i.created_at).filter(Boolean).sort()[0];
  // The side each end of each wire leaves its island by, as the sea first says: by the wire's number and its end.
  let sea, wires;
  const kept = new Map();
  const boxOf = (b) => [sea.x.get(seaId(b.id)), sea.y.get(seaId(b.id)), ...size(b)];
  const place = () => {
    sea = run({ combed: true,
      items: blocks.map((b) => ({ id: seaId(b.id), type: 'island', title: '', size: size(b), ...(first(b) && { created_at: first(b) }) })),
      links: reads.map((l, k) => ({ type: `sea:${k}`, from: seaId(islandOf(l.from)), to: seaId(islandOf(l.to)) })),
    });
    // Each sea wire's ends: a port on the side of its island it meets, as far along its first frame as the sea has it.
    wires = reads.map((l, k) => {
      const t = sea.ties.find((w) => w.type === `sea:${k}`), ends = [l.from, l.to].map(islandOf).map((id) => byId.get(id));
      const at = (b, p) => { const { side, share } = sideOf(boxOf(b), p), ax = 1 - SIDES[side][0], f = b.base; return { side, along: ax ? f.t + share * (f.b - f.t) : f.l + share * (f.r - f.l) }; };
      const sketch = t?.points ?? [[boxOf(ends[0])[0], boxOf(ends[0])[1]], [boxOf(ends[1])[0], boxOf(ends[1])[1]]];
      // A finding read across is named where it leaves its island: its port there is its name, one for all its reads
      // that leave by that side, and takes room on the frame as any box does. A reader's port is small, one to a read.
      const gated = ends.every((b) => b.shore), wide = gated ? labels(l) : 0;
      return {
        l, k, sketch, gated, ends: ends.map((b, e) => {
          const found = at(b, e ? sketch.at(-1) : sketch[0]), side = kept.get(`${k}:${e}`) ?? found.side, along = found.along, named = e && wide;
          kept.set(`${k}:${e}`, side);
          return { block: b, side, along, to: e ? l.to : l.from, id: named ? `\u0000find:${l.to}:${side}` : `\u0000port:${k}:${e}`, size: named ? [wide, GATE] : [PORT, PORT], small: !named };
        }),
      };
    });
  };
  // Each island laid out again by the flow's own layout with its ports, its name and its legend boxes of it, so its own
  // wires and those to its ports are wired at once, by the same layers.
  const wireIslands = () => {
    for (const b of blocks) {
      const ports = [...new Map(wires.flatMap((w) => w.ends.filter((e) => e.block === b)).map((e) => [e.id, { id: e.id, side: e.side, to: e.to, size: e.size, small: e.small }])).values()];
      const extras = [b.first.named && { id: '\u0000name', size: [b.first.named.r - b.first.named.l, b.first.named.b - b.first.named.t] }, b.first.keyed && { id: '\u0000legend', size: [b.first.keyed.r - b.first.keyed.l, b.first.keyed.b - b.first.keyed.t] }].filter(Boolean);
      b.ported = ports.length ? run({ items: b.items, links: b.links, ports, extras }) : null;
      if (b.ported) b.frame = b.ported.frame;
    }
  };
  // The second pass: the sea says which side each wire leaves its island by, kept from then on; each island is wired to
  // its ports there; and the sea is placed again round what that made of each island, so it is placed last.
  for (const b of blocks) b.base = b.frame;
  place();
  wireIslands();
  for (const b of blocks) {
    // How many wires leave by each side, and how far a port there reaches out into the sea.
    (b.leaving = new Map()), (b.reach = new Map());
    for (const w of wires) for (const e of w.ends) if (e.block === b) {
      b.leaving.set(e.side, (b.leaving.get(e.side) ?? 0) + 1);
      b.reach.set(e.side, Math.max(b.reach.get(e.side) ?? 0, e.size[SIDES[e.side][0]] / 2));
    }
  }
  place();
  // Where each island stands: its frame's middle on its box's.
  for (const b of blocks) {
    const [cx, cy] = boxOf(b);
    const m = margin(b);
    b.dx = cx - (m.right - m.left) / 2 - (b.frame.l + b.frame.r) / 2;
    b.dy = cy - (m.bottom - m.top) / 2 - (b.frame.t + b.frame.b) / 2;
  }
  for (const b of blocks) {
    b.model = b.ported ?? b.model;
    if (b.ported) ({ named: b.named, keyed: b.keyed } = b.ported.placed);
  }
  // One model: every place moved by its island's.
  const nodes = new Map(), x = new Map(), y = new Map(), chains = [], ties = [], all = [], breaks = [], potential = new Set();
  const move = (b) => (p) => [p[0] + b.dx, p[1] + b.dy];
  for (const b of blocks) {
    const m = b.model, to = move(b);
    for (const [id, n] of m.nodes) if (m.x.has(id)) (nodes.set(id, n), x.set(id, m.x.get(id) + b.dx), y.set(id, m.y.get(id) + b.dy));
    all.push(...m.all);
    for (const id of m.potential) potential.add(id);
    const moved = (w) => ({ ...w, points: w.points.map(to), ...(w.gaps && { gaps: w.gaps.map(to) }) });
    chains.push(...m.chains.map(moved));
    ties.push(...m.ties.map(moved));
    breaks.push(...m.breaks.map((k) => ({ ...k, at: to(k.at) })));
  }
  // The sea set again round its ports: islands and ports held where they stand, every wire at sea placed by the solve.
  const portAt = (e) => { const p = e.block.ported?.ported.get(e.id); return p ? move(e.block)(p.at) : null; };
  const held = new Map(), lines = [];
  for (const b of blocks) {
    const f = b.frame, at = [(f.l + f.r) / 2 + b.dx, (f.t + f.b) / 2 + b.dy], wh = [f.r - f.l, f.b - f.t];
    held.set(`\u0000isle:${seaId(b.id)}`, { id: `\u0000isle:${seaId(b.id)}`, at, size: wh, named: [...wh] });
  }
  for (const w of wires) {
    const at = w.ends.map(portAt);
    if (at.some((p) => !p)) continue;
    w.ends.forEach((e, k) => held.set(e.id, { id: e.id, at: [...at[k]], size: [...e.size], named: [...e.size], port: e.small, gate: true }));
    w.line = { a: w.ends[0].id, b: w.ends[1].id, points: onPorts(w.sketch, w.ends.map((e, k) => ({ side: e.side, at: at[k], size: e.size, frame: { l: e.block.frame.l + e.block.dx, t: e.block.frame.t + e.block.dy, r: e.block.frame.r + e.block.dx, b: e.block.frame.b + e.block.dy } })), SEA / 4) };
    lines.push(w.line);
  }
  // Each wire's way chosen again between its ports, as inside an island: out of each port across its side, crossing least.
  const zs = blocks[0].raw.z, inward = new Map(wires.flatMap((w) => w.ends.map((e) => [e.id, SIDES[e.side]])));
  const home = new Map(wires.flatMap((w) => w.ends.map((e) => [e.id, `\u0000isle:${seaId(e.block.id)}`])));
  shape(new Map([...held.values()].map((b) => [b.id, { x: b.at[0], y: b.at[1], w: b.size[0], h: b.size[1] }])), lines, { room: zs.room, run: zs.run, corner: zs.corner, wire: zs.turn, ports: zs.ports, rounds: zs.rounds, cost_cross: zs.shape_cross, cost_bend: zs.cost_bend, cost_side: zs.cost_side, work: zs.shape_work, inward, home });
  // At sea a wire keeps the sea's distance from an island, half the sea between two, and its own from the wire beside it.
  settle({ boxes: [...held.values()], lines, held: new Set(held.keys()), ...keeps(zs), room: SEA / 2, rounds: 2 });
  // Each link across: in from its reader to the reader's port, over the sea, and in from the finding's port to the finding.
  const inner = (e) => e.block.ported.ported.get(e.id).points.map(move(e.block));
  const routed = [], shared = new Set();
  for (const w of wires.filter((v) => v.line)) {
    const [a, c] = [w.l.from, w.l.to], over = w.line.points, named = w.ends[1];
    // Reads of one finding that leave by one name share the wire in to it: drawn once, the rest each their own.
    const points = [...inner(w.ends[0]).reverse(), ...over, ...(named.small ? inner(named) : [])];
    if (!named.small && !shared.has(named.id)) (shared.add(named.id), ties.push({ a, b: c, type: w.l.type ?? w.l.kind, headAt: 'end', points: inner(named), ...(w.l.pending && { pending: w.l.pending }) }));
    const way = (e) => SIDES[e.side][0] ? [0, SIDES[e.side][1]] : [SIDES[e.side][1], 0];
    const gates = w.gated ? w.ends.map((e) => ({ island: e.block.id, at: portAt(e), way: way(e), ...(!e.small && { port: e.id }) })) : [];
    const label = !named.small && { id: named.id, at: portAt(named), w: named.size[0] };
    const tie = { a, b: c, type: w.l.type ?? w.l.kind, headAt: 'end', points, crossing: true, gates, ...(label && { label }), ...(w.gated && { sea: over }), ...(w.l.pending && { pending: w.l.pending }) };
    routed.push(tie);
    ties.push(tie);
  }
  const shores = blocks.filter((b) => b.shore).map((b) => {
    const f = b.frame, land = { l: f.l + b.dx, t: f.t + b.dy, r: f.r + b.dx, b: f.b + b.dy };
    const name = b.named ? [b.named.l + b.dx, (b.named.t + b.named.b) / 2 + b.dy] : [land.l + PAD, land.t + PAD + NAME / 2];
    const lx = (b.keyed?.l ?? 0) + b.dx, ly = (b.keyed?.t ?? 0) + b.dy;
    return { id: b.id, land: [land], name, entries: b.legend.at.map(([ex, ey]) => [lx + ex, ly + ey]), steps: new Set(b.items.map((i) => i.id)) };
  });
  const extent = [...shores.map((s) => [s.land[0].r, s.land[0].b]), ...[...x.keys()].map((id) => [x.get(id) + nodes.get(id).w / 2, y.get(id) + nodes.get(id).h / 2]), ...routed.flatMap((t) => t.points), ...[...held.values()].map((b) => [b.at[0] + b.size[0] / 2, b.at[1] + b.size[1] / 2])];
  return {
    nodes, all, chains, ties, breaks, potential, x, y,
    width: Math.max(...extent.map((p) => p[0])) + M, height: Math.max(...extent.map((p) => p[1])) + M,
    islands: shores,
  };
}
