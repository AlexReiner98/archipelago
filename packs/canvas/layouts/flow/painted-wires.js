// The wires that come into a painted island (./painted.js): a link from an item outside to one its look paints is
// routed as any wire is, to where the map would have placed that item, and its stretch inside the island's frame is
// under the paint. This says where each comes in at the frame and whether its head is at that end, so the surface can
// carry it on to where the look draws the item. Layer: metrics. Pure: the model in, places out.

/** Where the segment from a, outside the frame { at, size }, to b, inside it, crosses its edge. */
export function edgeOf([ax, ay], [bx, by], { at: [x0, y0], size: [w, h] }) {
  const ts = [[x0, ax, bx], [x0 + w, ax, bx], [y0, ay, by], [y0 + h, ay, by]].map(([e, a, b]) => (b !== a ? (e - a) / (b - a) : -1));
  const on = ts.filter((t) => t >= 0 && t <= 1).map((t) => [ax + (bx - ax) * t, ay + (by - ay) * t]).filter(([x, y]) => x >= x0 - 0.5 && x <= x0 + w + 0.5 && y >= y0 - 0.5 && y <= y0 + h + 0.5);
  return on.sort((p, q) => Math.hypot(p[0] - ax, p[1] - ay) - Math.hypot(q[0] - ax, q[1] - ay))[0] ?? [bx, by];
}

/**
 * The wires coming into the painted island `c` ({ id, canvas: { at, size } }): each { item, at, head }, the item it
 * ends on inside, where it meets the frame, and whether a head is drawn at that end. `g` the composed model (its chains
 * and ties, each with a, b and points), `items` the answer's, `painted` the ids of every item a look paints, `endsOf`
 * which end of a link type takes the head, `order` the type the chains are of.
 */
export function comingIn(c, { g, items, painted, endsOf, order }) {
  const inside = ([x, y]) => x > c.canvas.at[0] && x < c.canvas.at[0] + c.canvas.size[0] && y > c.canvas.at[1] && y < c.canvas.at[1] + c.canvas.size[1];
  const mine = (id) => painted.has(id) && items.find((i) => i.id === id)?.island === c.id;
  return [...g.chains.map((w) => [w, order]), ...g.ties.map((w) => [w, w.type])].flatMap(([w, type]) => {
    if (mine(w.a) === mine(w.b) || !w.points?.length) return [];
    const last = mine(w.b), pts = last ? w.points : [...w.points].reverse(), k = pts.findIndex(inside);
    const at = k > 0 ? edgeOf(pts[k - 1], pts[k], c.canvas) : pts[pts.length - 1];
    const ends = endsOf(type), atEnd = ends !== 'start' && !w.toPort, atStart = ends !== 'end' && !w.stop && !w.fromPort;
    const headLast = w.headAt === 'start' ? atStart : atEnd, headFirst = w.headAt === 'start' ? atEnd : atStart;
    return [{ item: last ? w.b : w.a, at, head: last ? headLast : headFirst }];
  });
}
