// A port: where a wire that leaves an island meets its side (design e_87x2us2b, stages 3, 4 and 10; settled e_h5w7udq4,
// e_gngj3gy9). An island is laid out alone first, to a frame round its steps, its name and its legend. Once the sea has
// said which side each wire that leaves it goes by, the island is laid out again by the flow's own layout with each port
// a box of it, linked to what it is wired to, and its name and legend boxes too: the topology orders them with the rest,
// the shape layer chooses every wire's way at once, the port's leaving into the island, and the one solve sets every
// place, a port beyond all else on its side and on one line with that side's other ports (`edge`), free along it. The
// frame is drawn round what the solve left, its sides with ports on their line. Layer: metrics, before the shape: it sets
// where each port first stands. Pure: places in, places out.

import { FALL, RISE } from './graph.js';
/** Each side of a frame: the axis a wire crosses it on, and which way is out. */
export const SIDES = { top: [1, -1], bottom: [1, 1], left: [0, -1], right: [0, 1] };

/** The link type a port is wired to its item by, inside the layout alone. */
export const PORT_LINK = 'port~';

/** The rect round boxes { l, t, r, b } and points. */
const bounds = (rects, points = []) => ({
  l: Math.min(...rects.map((r) => r.l), ...points.map((p) => p[0])), t: Math.min(...rects.map((r) => r.t), ...points.map((p) => p[1])),
  r: Math.max(...rects.map((r) => r.r), ...points.map((p) => p[0])), b: Math.max(...rects.map((r) => r.b), ...points.map((p) => p[1])),
});
const rectOf = (at, size) => ({ l: at[0] - size[0] / 2, t: at[1] - size[1] / 2, r: at[0] + size[0] / 2, b: at[1] + size[1] / 2 });
const boxOf = (nodes, x, y, id) => rectOf([x.get(id), y.get(id)], [nodes.get(id).w, nodes.get(id).h]);

/** What an island's first layout (`raw`, the flow's own places) takes up: its steps and its wires. */
export const insideOf = (raw) => bounds([...raw.x.keys()].map((id) => boxOf(raw.nodes, raw.x, raw.y, id)), [...raw.routes.values()].flatMap((r) => r.points));

/**
 * An island's frame, from its first layout: its steps and wires, beside a header at their left of its name (`name` wide)
 * over its legend (`legend`, { w, h }), all `pad` inside the frame. Answers with the frame and where the name and the
 * legend stand, in the island's own places.
 */
export function frameOf(raw, { name = 0, legend, pad, room, gap }) {
  const inside = insideOf(raw), wide = Math.max(name, legend?.w ?? 0), l = inside.l - gap - wide;
  const named = name ? { l, t: inside.t, r: l + name, b: inside.t + room } : null, under = named ? named.b : inside.t;
  const keyed = legend?.h ? { l, t: under, r: l + legend.w, b: under + legend.h } : null;
  const all = bounds([inside, ...[named, keyed].filter(Boolean)]);
  return { frame: { l: all.l - pad, t: all.t - pad, r: all.r + pad, b: all.b + pad }, named, keyed };
}

/**
 * A first sketch from a port at `at`, across its side on `axis`, to the box `to`: out of the port, along a channel `run`
 * clear of the box's near side, and into that side at its middle. It turns there, so where the port stands along its side
 * is not tied to where the box does (a wire run straight in would tie the two, and the solve could keep only one).
 */
function sketch(at, axis, to, run) {
  const other = 1 - axis, way = Math.sign(at[axis] - to.at[axis]) || 1, near = to.at[axis] + (way * to.size[axis]) / 2, channel = near + way * run;
  const point = (u, v) => { const p = []; p[axis] = u; p[other] = v; return p; };
  return [point(at[axis], at[other]), point(channel, at[other]), point(channel, to.at[other]), point(near, to.at[other])];
}

/**
 * The items and links an island is laid out by again: its own, each port an item of its size (`ports` are { id, side, to,
 * size, small }), and its name and legend (`extras`, { id, size }) items of their own. A port's wire is not a link of the
 * topology: it is put in after it (`setPorts`), so ports do not join parts of the island that stand apart.
 */
export function portItems(items, links, ports, extras) {
  const boxes = [...ports.map((p) => ({ id: p.id, type: 'port~', title: '', size: p.size })), ...extras.map((e) => ({ id: e.id, type: 'port~', title: '', size: e.size }))];
  // A port on the top or foot is part of the island's order: under a rise every top port stands over its step, and over a
  // fall every foot port under its own, so the topology gives each port's wire a column of its own out to that side.
  const ends = [], wires = [];
  for (const p of ports.filter((q) => ORDERED.includes(q.side))) {
    const term = TERMINAL[p.side];
    if (!ends.includes(term)) ends.push(term);
    wires.push(...(p.side === 'top' ? [{ type: PORT_LINK, from: term, to: p.id }, { type: PORT_LINK, from: p.id, to: p.to }] : [{ type: PORT_LINK, from: p.to, to: p.id }, { type: PORT_LINK, from: p.id, to: term }]));
  }
  // The rise and the fall joined, so the numbering can take them for its top and its foot.
  if (ends.length === 2) wires.push({ type: PORT_LINK, from: RISE, to: FALL });
  return { items: [...items, ...boxes, ...ends.map((id) => ({ id, type: 'port~', title: '', size: [1, 1] }))], links: [...links, ...wires] };
}

/** The sides whose ports the topology orders, and the end each is laid out under or over. */
const ORDERED = ['top', 'bottom'], TERMINAL = { top: RISE, bottom: FALL };

/**
 * Where the first sketch has them, set the ports and the island's header where they go: the header over the steps at the
 * left, each port beyond all of it on its side, beside what it is wired to, its wire
 * sketched in across the side, a tie of its own (`ties`). Each port's node is marked for the solve (`edge`, `small`).
 * Answers with the way each port's wire must leave it, for the shape layer.
 */
export function setPorts({ nodes, x, y, routes, ties, ports, extras, gap, pad, run }) {
  const own = new Set([...ports.map((p) => p.id), ...extras.map((e) => e.id)]);
  const ids = [...x.keys()].filter((id) => !own.has(id));
  const inside = bounds(ids.map((id) => boxOf(nodes, x, y, id)), [...routes].filter(([k]) => !k.split('|').some((id) => own.has(id))).flatMap(([, r]) => r.points));
  const put = (id, l, t) => (x.set(id, l + nodes.get(id).w / 2), y.set(id, t + nodes.get(id).h / 2));
  // The header (its name over its legend) beside the steps at their left, level with their top, where the solve keeps
  // it (`first`): the ports are on the top and the foot, so no wire need cross it.
  for (const e of extras) (put(e.id, inside.l - gap - e.size[0], inside.t), (nodes.get(e.id).first = true));
  // Beyond every box and every wire already drawn, so the sketch already has each port outermost, as the solve will.
  const all = bounds([inside, ...extras.map((e) => boxOf(nodes, x, y, e.id))]);
  const inward = new Map(), boxed = (id) => ({ at: [x.get(id), y.get(id)], size: [nodes.get(id).w, nodes.get(id).h] });
  // Along each side, each port first beside what it is wired to, then the side's ports set apart in that order, so no
  // two stand on one another and the solve starts from a drawing it can keep.
  // What the topology ordered stands where it put it; the rise and the fall go, with their wires.
  const terms = new Set(Object.values(TERMINAL));
  for (const id of terms) (x.delete(id), y.delete(id));
  for (const k of [...routes.keys()]) if (k.split('|').some((id) => terms.has(id))) routes.delete(k);
  for (let i = ties.length - 1; i >= 0; i--) if (terms.has(ties[i].a) || terms.has(ties[i].b)) ties.splice(i, 1);
  const placed = new Set(ports.filter((p) => !ORDERED.includes(p.side)).map((p) => p.id));
  // A port the topology ordered keeps its column, and stands past everything on its side, the header too: its wire,
  // straight down its column, only grows longer.
  for (const p of ports.filter((q) => ORDERED.includes(q.side))) {
    const [axis, out] = SIDES[p.side], n = nodes.get(p.id), at = [x.get(p.id), y.get(p.id)];
    at[axis] = (out < 0 ? (axis ? all.t : all.l) : axis ? all.b : all.r) + out * (pad + (axis ? n.h : n.w) / 2);
    (x.set(p.id, at[0]), y.set(p.id, at[1]));
    for (const [k, r] of routes) if (k.split('|').includes(p.id)) r.points = r.points.map((q, i, all_) => (i === 0 && r.from === p.id) || (i === all_.length - 1 && r.from !== p.id) ? [...at] : q);
  }
  for (const side of Object.keys(SIDES).filter((s) => !ORDERED.includes(s))) {
    const [axis, out] = SIDES[side], other = 1 - axis, on = ports.filter((p) => p.side === side);
    const want = (p) => boxed(p.to).at[other];
    let end = -Infinity;
    for (const p of on.sort((u, v) => want(u) - want(v))) {
      const n = nodes.get(p.id), half = (other ? n.h : n.w) / 2, at = [];
      at[axis] = (out < 0 ? (axis ? all.t : all.l) : axis ? all.b : all.r) + out * (pad + (axis ? n.h : n.w) / 2);
      at[other] = Math.max(want(p), (other ? all.t : all.l) + half, end + gap + half);
      end = at[other] + half;
      (x.set(p.id, at[0]), y.set(p.id, at[1]));
    }
  }
  for (const p of ports) {
    const [axis, out] = SIDES[p.side], n = nodes.get(p.id), at = [x.get(p.id), y.get(p.id)], to = boxed(p.to);
    Object.assign(n, { edge: [axis, out], small: p.small });
    inward.set(p.id, [axis, -out]);
    if (!placed.has(p.id)) continue;
    const route = p.id < p.to ? `${p.id}|${p.to}` : `${p.to}|${p.id}`;
    routes.set(route, { from: p.id, points: sketch(at, axis, to, run) });
    ties.push({ a: p.id, b: p.to, type: PORT_LINK, route });
  }
  inward.placed = placed;
  return inward;
}

/**
 * A finished island laid out with its ports, as the archipelago reads it: its steps and wires without the ports, the name
 * and the legend; each port's middle and its wire from the port to its item (`ported`, by id); where the name and legend
 * stand (`placed`); and its frame, `pad` round all of it, a side with ports on their line.
 */
export function apart(model, { ports, extras, pad }) {
  const portIds = new Set(ports.map((p) => p.id)), own = new Set([...portIds, ...extras.map((e) => e.id)]);
  const { nodes, x, y } = model, ported = new Map();
  for (const t of model.ties) if (t.type === PORT_LINK) {
    const id = portIds.has(t.a) ? t.a : t.b;
    ported.set(id, { at: [x.get(id), y.get(id)], points: t.a === id ? t.points : [...t.points].reverse() });
  }
  const placed = Object.fromEntries(extras.map((e) => [e.id.slice(1), boxOf(nodes, x, y, e.id)]));
  const kept = (m) => new Map([...m].filter(([id]) => !own.has(id)));
  const ties = model.ties.filter((t) => t.type !== PORT_LINK), steps = [...kept(x).keys()];
  const inside = bounds([...steps, ...extras.map((e) => e.id)].map((id) => boxOf(nodes, x, y, id)), [...model.chains, ...ties, ...ported.values()].flatMap((w) => w.points));
  const edge = {};
  for (const p of ports) edge[p.side] = ported.get(p.id)?.at[SIDES[p.side][0]];
  const frame = { l: edge.left ?? inside.l - pad, t: edge.top ?? inside.t - pad, r: edge.right ?? inside.r + pad, b: edge.bottom ?? inside.b + pad };
  return { ...model, nodes: kept(nodes), x: kept(x), y: kept(y), all: model.all.filter((n) => !own.has(n.id)), ties, ported, placed, frame };
}

/**
 * A first sketch from a port at `at` on `side` of the box `rect` to the point `to` on that box's side: out of the port
 * across its side to `ring` beyond the box, then round it the shorter way to the point level with `to`.
 */
function around(at, side, rect, ring, to) {
  const r = { l: rect.l - ring, t: rect.t - ring, r: rect.r + ring, b: rect.b + ring };
  const order = ['top', 'right', 'bottom', 'left'], corner = { top: [r.r, r.t], right: [r.r, r.b], bottom: [r.l, r.b], left: [r.l, r.t] };
  const onRing = (s, q) => (s === 'top' ? [q[0], r.t] : s === 'bottom' ? [q[0], r.b] : s === 'left' ? [r.l, q[1]] : [r.r, q[1]]);
  const near = { top: Math.abs(to[1] - rect.t), bottom: Math.abs(to[1] - rect.b), left: Math.abs(to[0] - rect.l), right: Math.abs(to[0] - rect.r) };
  const end = Object.keys(near).reduce((s, k) => (near[k] < near[s] ? k : s), 'top');
  const N = order.length, from = order.indexOf(side), steps = (order.indexOf(end) - from + N) % N, way = steps <= N / 2 ? 1 : -1;
  const path = [at, onRing(side, at)];
  // Clockwise each side ends at its corner; the other way each starts at the previous side's.
  for (let k = 0, s = from; k < (way > 0 ? steps : N - steps); k++, s = (s + way + N) % N) path.push(corner[order[way > 0 ? s : (s + N - 1) % N]]);
  return [...path, onRing(end, to)];
}

/**
 * Ports held on boxes, at a level above an island (`held`: { id, on, at, side }, `at` the port's middle from its box's).
 * Each link of a type `rewire` names ({ type: [from, to] }, ports) is a wire whose ends the solve holds at those two
 * ports (its route's `ends`), sketched as the layout first drew it between the boxes, each end brought round its box
 * from its port. The shape leaves it as sketched: where it ends is not the shape's to choose.
 */
export function holdPorts({ nodes, x, y, routes, ties, held, rewire, run }) {
  const port = new Map(held.map((p) => [p.id, p]));
  const rectOf = (id) => ({ l: x.get(id) - nodes.get(id).w / 2, t: y.get(id) - nodes.get(id).h / 2, r: x.get(id) + nodes.get(id).w / 2, b: y.get(id) + nodes.get(id).h / 2 });
  const at = (p) => [x.get(p.on) + p.at[0], y.get(p.on) + p.at[1]];
  for (const t of ties) {
    const ends = rewire[t.type], r = routes.get(t.route);
    if (!ends || !port.has(ends[0]) || !port.has(ends[1]) || !r) continue;
    const drawn = r.from === t.a ? r.points : [...r.points].reverse(), [pa, pb] = ends.map((id) => port.get(id));
    const into = [around(at(pa), pa.side, rectOf(pa.on), run, drawn[0]), around(at(pb), pb.side, rectOf(pb.on), run, drawn.at(-1))];
    routes.set(t.route, { from: t.a, points: [...into[0], ...drawn.slice(1, -1), ...into[1].reverse()], ends: [pa.at, pb.at], sides: [pa.side, pb.side] });
  }
}
