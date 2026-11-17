// A view that is a list of islands (feature e_u52abqr4, the owner, 17 Nov 2026): no solver. Each item stands at its
// place on its island (its field `cell`, [column, row], set by an agent and the same in every view), each island at the
// corner the view keeps for it (`placed`, by island id), in cells as wide and tall as the picture's largest box. What
// no agent has placed yet stands in a block at its island's left edge, as many columns as make it the pane's shape
// (`aspect`, width over height: Alex, 17 Nov 2026, a big island not one tall column); what lives on no island, in a row
// below all.
// Wires are straight, from box edge to box edge. Layer: metrics. Pure: the layout's args in, the model out.

import { lookOut } from './looks.js';

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
  // Islands an agent has given a corner stand there; the rest follow in a row to the right of all of those.
  const own = [...groups].filter(([id]) => id !== null).sort(([a], [b]) => Number(!cellOf(corners[a])) - Number(!cellOf(corners[b])));
  let right = M - GAP;
  for (const [id, items] of own) {
    const corner = cellOf(corners[id]), top = heads.get(id) ?? 0;
    const l = corner ? M + corner[0] * cw : right + GAP, t = corner ? M + corner[1] * ch : M;
    // An island with a look of its own (./looks.js) stands where its look puts what it holds; what the look leaves
    // unplaced is placed by cell beside it.
    const given = args.looks?.get(id), look = given && lookOut(given.look, { ...given, nodes: items, sizes, measure: args.measure });
    // Where its focus stands, as the island's style says (look.focus, decision e_up4wjd94): at its cell, in the corner
    // before the rest, or over them; a look of its own places it as it likes.
    const fat = !look && args.focusAt?.get(id), fn = fat === 'corner' || fat === 'top' ? items.find((n) => n.id === id) : null;
    const lx = l + PAD, ly = t + PAD + top, rest = (look ? items.filter((n) => !look.places.has(n.id)) : items).filter((n) => n !== fn), after = look ? look.width + GAP : 0;
    const dx = fn && fat === 'corner' ? fn.w + GAP : 0, dy = fn && fat === 'top' ? fn.h + GAP : 0;
    if (look) for (const n of items) if (look.places.has(n.id)) x.set(n.id, lx + look.places.get(n.id)[0]), y.set(n.id, ly + look.places.get(n.id)[1]);
    const unplaced = rest.filter((n) => !cellBy.get(n.id)), shift = unplaced.length ? columns(unplaced.length, args.aspect, cw, ch) : 0;
    const at = (n, [c, r]) => (x.set(n.id, lx + after + dx + c * cw + n.w / 2), y.set(n.id, ly + dy + r * ch + n.h / 2));
    // Row by row across the block, so the order they came in reads left to right, then down.
    unplaced.forEach((n, k) => at(n, [k % shift, Math.floor(k / shift)]));
    for (const n of rest) if (cellBy.get(n.id)) at(n, [cellBy.get(n.id)[0] + shift, cellBy.get(n.id)[1]]);
    // Over the rest it stands in the middle of their width; in the corner, first.
    const wide = Math.max(fn?.w ?? 0, ...rest.map((n) => x.get(n.id) + n.w / 2 - lx));
    if (fn) x.set(fn.id, fat === 'top' ? lx + wide / 2 : lx + fn.w / 2), y.set(fn.id, ly + fn.h / 2);
    const r = Math.max(l + (wides.get(id) ?? 0), look ? lx + look.width + PAD : l, ...items.map((n) => x.get(n.id) + n.w / 2 + PAD));
    const b = Math.max(look ? ly + look.height + PAD : t, ...items.map((n) => y.get(n.id) + n.h / 2 + PAD));
    islands.push({ id, rect: [l, t, r, b], land: [{ l, t, r, b }], ...(look && { look: { at: [lx, ly], paint: look.paint, items: look.items } }) });
    bottom = Math.max(bottom, b);
    right = Math.max(right, r);
  }
  (groups.get(null) ?? []).forEach((n, k) => (x.set(n.id, M + k * cw + n.w / 2), y.set(n.id, bottom + GAP + n.h / 2)));
  return { m, nodes: m.nodes, x, y, ...straight(m, x, y), islands, ports: [] };
}

/** How many columns `n` boxes of cells `cw` by `ch` take to stand in a block of `aspect` (width over height): one with no aspect. */
export const columns = (n, aspect, cw, ch) => (aspect > 0 ? Math.max(1, Math.min(n, Math.round(Math.sqrt((n * aspect * ch) / cw)))) : 1);

/** The kit's graph `m` wired straight, from box edge to box edge, its boxes standing at `x`, `y`: its chains and ties. */
export function straight(m, x, y) {
  const line = (w) => {
    const a = m.nodes.get(w.a), b = m.nodes.get(w.b), pa = [x.get(w.a), y.get(w.a)], pb = [x.get(w.b), y.get(w.b)];
    return { ...w, points: [edge(pa, a, pb), edge(pb, b, pa)] };
  };
  const drawn = (w) => m.nodes.has(w.a) && m.nodes.has(w.b) && w.a !== w.b;
  return { chains: m.chains.filter(drawn).map(line), ties: m.ties.filter(drawn).map(line) };
}
