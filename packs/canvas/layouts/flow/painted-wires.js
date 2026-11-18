// What a painted island's look hands the map once it has settled (decision e_jfctpqza, the owner, 18 Nov 2026): each
// item's place, with the radius it draws it at. A look draws everything on its island, its own lines included (decision
// e_a6kbgg8c, revised by the owner, 18 Nov 2026), so the links among its items are not the map's; the map ends each
// wire from another island on its item there. This checks what a look hands and says what those wires become: each
// re-routed to the item's edge, from the other end's box. Layer: metrics. Pure: what was handed in, patches out.

/** A finite number. */
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * What a look handed, checked: `said` { places: { id: [x, y, r?] }, tags? }, in the island's units from its frame's top
 * left, for the items of `own` alone. Moved to the picture by the frame's corner `at`. Answers { places: Map(id → [x, y,
 * r]), tags }, or null where it gives no place: `tags` true where the look writes its rings' tags itself, in its own
 * names' room (overlap e_jhqsvwwh), so the map draws the rings alone.
 */
export function handedOf(said, own, [ax, ay]) {
  if (!said || typeof said !== 'object' || !said.places || typeof said.places !== 'object') return null;
  const places = new Map();
  for (const [id, at] of Object.entries(said.places)) {
    if (own.has(id) && Array.isArray(at) && num(at[0]) && num(at[1])) places.set(id, [ax + at[0], ay + at[1], num(at[2]) && at[2] > 0 ? at[2] : 0]);
  }
  return { places, tags: said.tags === true };
}

/** The model `g` without the links between two items of one painted island: those are its look's to draw. */
export function shoreOnly(g, islandOf, painted) {
  if (!painted.size) return g;
  const own = (w) => painted.has(w.a) && painted.has(w.b) && islandOf(w.a) === islandOf(w.b);
  return { ...g, chains: g.chains.filter((w) => !own(w)), ties: g.ties.filter((w) => !own(w)) };
}

/** Where the line from `c` toward `p` leaves an end: a circle of radius `r`, or a box { w, h } about it. */
function exit([cx, cy], end, [px, py]) {
  const dx = px - cx, dy = py - cy, l = Math.hypot(dx, dy);
  if (!l) return [cx, cy];
  if (end.r !== undefined) return [cx + (dx / l) * end.r, cy + (dy / l) * end.r];
  const t = Math.min(dx ? end.w / 2 / Math.abs(dx) : Infinity, dy ? end.h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

/** The straight line of a wire between ends `a` and `b` ({ at: [x, y], r } a placed item, { at, w, h } a box), edge to edge. */
export const lineOf = (a, b) => [exit(a.at, a, b.at), exit(b.at, b, a.at)];

/**
 * The patches that put every wire touching what was just placed where it now ends. `wires` [{ key, head, w, type }]: each
 * drawn wire's keys, its model (a, b, its points), its link type; `boxes` Map(id → { w, h, at }) where every other item
 * stands; `placed` Map(id → [x, y, r]) every item a look has placed so far; `painted` the ids a look draws (one not yet
 * placed keeps its wires hidden); `changed` the ids just placed; `draw(w)` and `heads(w, type)` the map's own path and
 * heads for a wire; `over` how long the move takes (0 at first).
 */
export function wirePatches({ wires, boxes, placed, painted, changed, draw, heads, over = 0 }) {
  const end = (id) => (placed.has(id) ? { at: placed.get(id).slice(0, 2), r: placed.get(id)[2] } : painted.has(id) ? null : boxes.get(id) ?? null);
  return wires.flatMap(({ key, head, w, type }) => {
    if (!changed.has(w.a) && !changed.has(w.b)) return [];
    const a = end(w.a), b = end(w.b);
    if (!a || !b) return [];
    const moved = { ...w, points: lineOf(a, b), gaps: [] }, tip = head && heads(moved, type), move = over ? { over } : {};
    return [{ key, set: { d: draw(moved) }, toggle: { unplaced: false }, ...move }, ...(head ? [{ key: head, set: { d: tip || '' }, toggle: { unplaced: !tip }, ...move }] : [])];
  });
}
