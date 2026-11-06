// A port: where a wire that leaves an island meets its side (design e_87x2us2b, stages 3, 4 and 10; settled e_h5w7udq4,
// e_gngj3gy9). An island is laid out alone first, to a frame round its steps, its name and its legend. Once the sea has
// said which side each wire that leaves it goes by, the island is laid out again by the flow's own layout with each port
// a box of it, linked to what it is wired to, and its name and legend boxes too: the topology orders them with the rest,
// the shape layer chooses every wire's way at once, the port's leaving into the island, and the one solve sets every
// place, a port beyond all else on its side and on one line with that side's other ports (`edge`), free along it. The
// frame is drawn round what the solve left, its sides with ports on their line. Layer: metrics, before the shape: it sets
// where each port first stands. Pure: places in, places out.

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

/** The lengths a solve of the flow keeps, from its own. */
export const keeps = (z) => ({ wire: z.turn, room: z.room, run: z.run, corner: z.corner, apart: z.gap / 2, join: z.join });

/**
 * An island's frame, from its first layout (`raw`, the flow's own places): its steps and wires, its name's room over them at
 * the left (`name` wide), its legend (`legend`, { w, h }) a column at their right, all `pad` inside the frame. Answers with
 * the frame and where the name and the legend stand, in the island's own places.
 */
export function frameOf(raw, { name = 0, legend, pad, room, gap }) {
  const boxes = [...raw.x.keys()].map((id) => boxOf(raw.nodes, raw.x, raw.y, id));
  const inside = bounds(boxes, [...raw.routes.values()].flatMap((r) => r.points));
  const named = name ? { l: inside.l, t: inside.t - room, r: inside.l + name, b: inside.t } : null;
  const keyed = legend?.h ? { l: inside.r + gap, t: inside.t, r: inside.r + gap + legend.w, b: inside.t + legend.h } : null;
  const all = bounds([inside, ...[named, keyed].filter(Boolean)]);
  return { frame: { l: all.l - pad, t: all.t - pad, r: all.r + pad, b: all.b + pad }, named, keyed };
}

/** A first sketch from a port at `at`, across its side on `axis`, to the box `to`: in across the side, then along to it. */
function sketch(at, axis, to) {
  const other = 1 - axis, near = to.at[axis] - (Math.sign(to.at[axis] - at[axis]) * to.size[axis]) / 2;
  const point = (u, v) => { const p = []; p[axis] = u; p[other] = v; return p; };
  if (Math.abs(at[other] - to.at[other]) < to.size[other] / 2) return [point(at[axis], at[other]), point(near, at[other])];
  const side = to.at[other] - (Math.sign(to.at[other] - at[other]) * to.size[other]) / 2;
  return [point(at[axis], at[other]), point(to.at[axis], at[other]), point(to.at[axis], side)];
}

/**
 * The items and links an island is laid out by again: its own, each port an item of its size (`ports` are { id, side, to,
 * size, small }) linked to what it is wired to, what is read above what reads it as everywhere, and its name and legend
 * (`extras`, { id, size }) items of their own.
 */
export function portItems(items, links, ports, extras) {
  const boxes = [...ports.map((p) => ({ id: p.id, type: 'port~', title: '', size: p.size })), ...extras.map((e) => ({ id: e.id, type: 'port~', title: '', size: e.size }))];
  const wires = ports.map((p) => (p.side === 'top' ? { type: PORT_LINK, from: p.id, to: p.to } : { type: PORT_LINK, from: p.to, to: p.id }));
  return { items: [...items, ...boxes], links: [...links, ...wires] };
}

/**
 * Where the first sketch has them, set the ports and the name and legend where they go: the name over the steps at the
 * left, the legend a column at their right, each port beyond all of it on its side, beside what it is wired to, its wire
 * sketched in across the side. Each port's node is marked for the solve (`edge`, `small`). Answers with the way each port's
 * wire must leave it, for the shape layer.
 */
export function setPorts({ nodes, x, y, routes, ports, extras, gap, pad }) {
  const own = new Set([...ports.map((p) => p.id), ...extras.map((e) => e.id)]);
  const ids = [...x.keys()].filter((id) => !own.has(id));
  const inside = bounds(ids.map((id) => boxOf(nodes, x, y, id)), [...routes].filter(([k]) => !k.split('|').some((id) => own.has(id))).flatMap(([, r]) => r.points));
  const put = (id, l, t) => (x.set(id, l + nodes.get(id).w / 2), y.set(id, t + nodes.get(id).h / 2));
  for (const e of extras) e.id.endsWith('name') ? put(e.id, inside.l, inside.t - gap - e.size[1]) : put(e.id, inside.r + gap, inside.t);
  const all = bounds([...ids, ...extras.map((e) => e.id)].map((id) => boxOf(nodes, x, y, id)));
  const inward = new Map();
  for (const p of ports) {
    const [axis, out] = SIDES[p.side], other = 1 - axis, n = nodes.get(p.id), size = [n.w, n.h], at = [];
    at[axis] = (out < 0 ? (axis ? all.t : all.l) : axis ? all.b : all.r) + out * (pad + size[axis] / 2);
    const to = { at: [x.get(p.to), y.get(p.to)], size: [nodes.get(p.to).w, nodes.get(p.to).h] }, lo = other ? all.t : all.l, hi = other ? all.b : all.r;
    at[other] = Math.min(Math.max(to.at[other], lo + size[other] / 2), hi - size[other] / 2);
    (x.set(p.id, at[0]), y.set(p.id, at[1]));
    Object.assign(n, { edge: [axis, out], small: p.small });
    inward.set(p.id, [axis, -out]);
    for (const [k, r] of routes) if (k.split('|').includes(p.id)) Object.assign(r, { from: p.id, points: sketch(at, axis, to) });
  }
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
  const placed = Object.fromEntries(extras.map((e) => [e.id.endsWith('name') ? 'named' : 'keyed', boxOf(nodes, x, y, e.id)]));
  const kept = (m) => new Map([...m].filter(([id]) => !own.has(id)));
  const ties = model.ties.filter((t) => t.type !== PORT_LINK), steps = [...kept(x).keys()];
  const inside = bounds([...steps, ...extras.map((e) => e.id)].map((id) => boxOf(nodes, x, y, id)), [...model.chains, ...ties, ...ported.values()].flatMap((w) => w.points));
  const edge = {};
  for (const p of ports) edge[p.side] = ported.get(p.id)?.at[SIDES[p.side][0]];
  const frame = { l: edge.left ?? inside.l - pad, t: edge.top ?? inside.t - pad, r: edge.right ?? inside.r + pad, b: edge.bottom ?? inside.b + pad };
  return { ...model, nodes: kept(nodes), x: kept(x), y: kept(y), all: model.all.filter((n) => !own.has(n.id)), ties, ported, placed, frame };
}
