// A view that is a list of islands (feature e_u52abqr4, the owner, 17 Nov 2026): no solver. Each item stands at its
// place on its island (its field `cell`, [column, row], set by an agent and the same in every view), each island at the
// corner the view keeps for it (`placed`, by island id), in cells as wide and tall as the picture's largest box. What
// no agent has placed yet stands in a column at its island's left edge; what lives on no island, in a row below all.
// Wires are straight, from box edge to box edge. Layer: metrics. Pure: the layout's args in, the model out.

/** A place [column, row] of whole cells, or nothing. */
const cellOf = (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0) ? v : null);

/** Where the line from a box's middle toward a point leaves the box. */
function edge([cx, cy], n, [px, py]) {
  const dx = px - cx, dy = py - cy;
  if (!dx && !dy) return [cx, cy];
  const t = Math.min(dx ? n.w / 2 / Math.abs(dx) : Infinity, dy ? n.h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

/**
 * The picture of `args` placed as agents set it: `m` the kit's graph, `islandOf(id)` where an item lives, `heads` how
 * tall each island's name and legend stand, `wides` how wide its header is, which its frame is at least. Answers what laidOut answers: the model's `x`, `y`, `nodes`, `chains`,
 * `ties` and each island's frame.
 */
export function placedOut(args, m, islandOf, heads, wides = new Map()) {
  const { sizes } = args, GAP = sizes.flow_node_gap, PAD = sizes.flow_island_pad, M = sizes.flow_margin;
  const corners = args.placed ?? {}, cellBy = new Map((args.items ?? []).map((i) => [i.id, cellOf(i.fields?.cell)]));
  const list = [...m.nodes.values()];
  const cw = Math.max(...list.map((n) => n.w)) + GAP, ch = Math.max(...list.map((n) => n.h)) + GAP;
  const groups = new Map();
  for (const n of list) (groups.get(islandOf(n.id)) ?? groups.set(islandOf(n.id), []).get(islandOf(n.id))).push(n);
  const x = new Map(), y = new Map(), islands = [];
  let bottom = M;
  const own = [...groups].filter(([id]) => id !== null);
  for (const [id, items] of own) {
    const corner = cellOf(corners[id]) ?? [0, 0], top = heads.get(id) ?? 0;
    const unplaced = items.filter((n) => !cellBy.get(n.id)), shift = unplaced.length ? 1 : 0;
    const l = M + corner[0] * cw, t = M + corner[1] * ch;
    const at = (n, [c, r]) => (x.set(n.id, l + PAD + c * cw + n.w / 2), y.set(n.id, t + PAD + top + r * ch + n.h / 2));
    unplaced.forEach((n, k) => at(n, [0, k]));
    for (const n of items) if (cellBy.get(n.id)) at(n, [cellBy.get(n.id)[0] + shift, cellBy.get(n.id)[1]]);
    const r = Math.max(l + (wides.get(id) ?? 0), ...items.map((n) => x.get(n.id) + n.w / 2 + PAD)), b = Math.max(...items.map((n) => y.get(n.id) + n.h / 2)) + PAD;
    islands.push({ id, rect: [l, t, r, b], land: [{ l, t, r, b }] });
    bottom = Math.max(bottom, b);
  }
  (groups.get(null) ?? []).forEach((n, k) => (x.set(n.id, M + k * cw + n.w / 2), y.set(n.id, bottom + GAP + n.h / 2)));
  return { m, nodes: m.nodes, x, y, ...straight(m, x, y), islands, ports: [] };
}

/** The kit's graph `m` wired straight, from box edge to box edge, its boxes standing at `x`, `y`: its chains and ties. */
export function straight(m, x, y) {
  const line = (w) => {
    const a = m.nodes.get(w.a), b = m.nodes.get(w.b), pa = [x.get(w.a), y.get(w.a)], pb = [x.get(w.b), y.get(w.b)];
    return { ...w, points: [edge(pa, a, pb), edge(pb, b, pa)] };
  };
  const drawn = (w) => m.nodes.has(w.a) && m.nodes.has(w.b) && w.a !== w.b;
  return { chains: m.chains.filter(drawn).map(line), ties: m.ties.filter(drawn).map(line) };
}
