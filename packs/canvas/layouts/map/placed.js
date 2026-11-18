// A view that is a list of islands (feature e_u52abqr4, the owner, 17 Nov 2026): no solver. Each item stands at its
// place on its island (its field `cell`, [column, row], set by an agent and the same in every view), each island at the
// corner the view keeps for it (`placed`, by island id), in cells as wide and tall as the picture's largest box. What
// no agent has placed yet stands in a block at its island's left edge, as many columns as make it the pane's shape
// (`aspect`, width over height: Alex, 17 Nov 2026, a big island not one tall column); what lives on no island, in a row
// below all.
// Wires are straight, from box edge to box edge. Layer: metrics. Pure: the layout's args in, the model out.

import { frameOut, framed, lookOut, paints } from './looks.js';

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
  // Islands an agent has given a corner stand there; the rest are laid out at the origin, then shelved after them (shelve).
  const own = [...groups].filter(([id]) => id !== null).sort(([a], [b]) => Number(!cellOf(corners[a])) - Number(!cellOf(corners[b])));
  let right = M - GAP;
  const loose = [];
  for (const [id, items] of own) {
    const corner = cellOf(corners[id]), top = heads.get(id) ?? 0;
    const l = corner ? M + corner[0] * cw : 0, t = corner ? M + corner[1] * ch : 0;
    // An island with a look of its own (./looks.js) stands where its look puts what it holds; what the look leaves
    // unplaced is placed by cell beside it.
    const given = args.looks?.get(id), look = given && lookOut(given.look, { ...given, nodes: items, sizes, measure: args.measure });
    // A look that paints (Field: code that draws on a canvas of its own, ./looks.js) is given a frame of the shape it says
    // it draws (its `frame`), within bounds, else the size its items would take in a block, and paints all of them there:
    // each stands at its middle, where a wire from another island ends, until the look hands its place.
    if (!look && given && paints(given.look)) {
      const k = columns(items.length, args.aspect, cw, ch), block = [k * cw - GAP, Math.ceil(items.length / k) * ch - GAP];
      const [w, h] = framed(block, frameOut(given.look, { ...given, nodes: items }), sizes), lx = l + PAD, ly = t + PAD + top;
      for (const n of items) x.set(n.id, lx + w / 2), y.set(n.id, ly + h / 2);
      const r = Math.max(l + (wides.get(id) ?? 0), lx + w + PAD), b = ly + h + PAD;
      islands.push({ id, rect: [l, t, r, b], land: [{ l, t, r, b }], canvas: { at: [lx, ly], size: [w, h] } });
      if (!corner) loose.push({ isle: islands.at(-1), items });
      else (bottom = Math.max(bottom, b)), (right = Math.max(right, r));
      continue;
    }
    // Where its focus stands, as the island's style says (look.focus, decision e_up4wjd94): at its cell, in the corner
    // before the rest, or over them; a look of its own places it as it likes.
    const fat = !look && args.focusAt?.get(id), fn = fat === 'corner' || fat === 'top' ? items.find((n) => n.id === id) : null;
    const lx = l + PAD, ly = t + PAD + top, rest = (look ? items.filter((n) => !look.places.has(n.id)) : items).filter((n) => n !== fn), after = look ? look.width + GAP : 0;
    const dx = fn && fat === 'corner' ? fn.w + GAP : 0, dy = fn && fat === 'top' ? fn.h + GAP : 0;
    if (look) for (const n of items) if (look.places.has(n.id)) x.set(n.id, lx + look.places.get(n.id)[0]), y.set(n.id, ly + look.places.get(n.id)[1]);
    const unplaced = rest.filter((n) => !cellBy.get(n.id)), shift = unplaced.length ? columns(unplaced.length, args.aspect, cw, ch) : 0, block = blockOf(unplaced, m, shift);
    // Each box in the middle of its cell, so a column of mixed kinds (a decision is wider than a task) keeps one line.
    const at = (n, [c, r]) => (x.set(n.id, lx + after + dx + c * cw + (cw - GAP) / 2), y.set(n.id, ly + dy + r * ch + (ch - GAP) / 2));
    // Row by row across the block, what is linked together kept together (blockOf).
    for (const [n, cell] of block) at(n, cell);
    for (const n of rest) if (cellBy.get(n.id)) at(n, [cellBy.get(n.id)[0] + shift, cellBy.get(n.id)[1]]);
    // Over the rest it stands in the middle of their width; in the corner, first.
    const wide = Math.max(fn?.w ?? 0, ...rest.map((n) => x.get(n.id) + n.w / 2 - lx));
    if (fn) x.set(fn.id, fat === 'top' ? lx + wide / 2 : lx + fn.w / 2), y.set(fn.id, ly + fn.h / 2);
    const r = Math.max(l + (wides.get(id) ?? 0), look ? lx + look.width + PAD : l, ...items.map((n) => x.get(n.id) + n.w / 2 + PAD));
    const b = Math.max(look ? ly + look.height + PAD : t, ...items.map((n) => y.get(n.id) + n.h / 2 + PAD));
    islands.push({ id, rect: [l, t, r, b], land: [{ l, t, r, b }], ...(look && { look: { at: [lx, ly], paint: look.paint, items: look.items } }) });
    if (!corner) loose.push({ isle: islands.at(-1), items });
    else (bottom = Math.max(bottom, b)), (right = Math.max(right, r));
  }
  ({ right, bottom } = shelve(loose, { x, y, from: [islands.length > loose.length ? right + sizes.flow_island_sea : M, M], gap: sizes.flow_island_sea, aspect: args.aspect, right, bottom }));
  (groups.get(null) ?? []).forEach((n, k) => (x.set(n.id, M + k * cw + n.w / 2), y.set(n.id, bottom + GAP + n.h / 2)));
  return { m, nodes: m.nodes, x, y, ...straight(m, x, y), islands, ports: [] };
}

/**
 * The cells of `nodes` in a block `columns` wide: each group of items linked together (in `m`'s chains and ties) in
 * a run of its own, from its most linked item outward, so a wire stays short; a group of more than one starts a row,
 * so where one group ends and the next begins is a row's edge, not the middle of one (study e_unru8ftt: a gap that said
 * nothing, wires across the whole island). Items linked to nothing here come last, together. Answers [node, [c, r]].
 */
export function blockOf(nodes, m, columns) {
  const ids = new Set(nodes.map((n) => n.id)), near = new Map(nodes.map((n) => [n.id, []]));
  for (const w of [...(m.chains ?? []), ...(m.ties ?? [])]) if (ids.has(w.a) && ids.has(w.b) && w.a !== w.b) near.get(w.a).push(w.b), near.get(w.b).push(w.a);
  const order = new Map(nodes.map((n, k) => [n.id, k])), seen = new Set(), groups = [];
  const most = (list) => [...list].sort((a, b) => near.get(b.id).length - near.get(a.id).length || order.get(a.id) - order.get(b.id))[0];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const members = [], queue = [n.id];
    seen.add(n.id);
    while (queue.length) for (const id of near.get(queue.shift())) if (!seen.has(id)) seen.add(id), queue.push(id), members.push(id);
    members.push(n.id);
    // From its most linked item, outward: each one's neighbours in the order they came.
    const from = most(members.map((id) => nodes[order.get(id)])), run = [from.id], put = new Set(run);
    for (let k = 0; k < run.length; k++) for (const id of [...near.get(run[k])].sort((a, b) => order.get(a) - order.get(b))) if (!put.has(id)) put.add(id), run.push(id);
    groups.push(run);
  }
  const lone = groups.filter((g) => g.length === 1).flat(), linked = groups.filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
  const cells = [];
  let c = 0, r = 0;
  for (const run of [...linked, lone]) {
    if (c) (c = 0), r++;
    for (const id of run) {
      cells.push([nodes[order.get(id)], [c, r]]);
      if (++c === columns) (c = 0), r++;
    }
  }
  return cells;
}

/**
 * Islands with no corner, each laid out from the origin, moved into shelves after those with one (verdict e_amqnqtsn:
 * one row of them ran off the frame): from `from`, toward the picture's shape (`aspect`, width over height), each
 * shelf under the tallest island of the one above, `gap` between. Moves each island's frame and what it holds in `x`,
 * `y`; answers the picture's right and bottom edges with them.
 */
export function shelve(loose, { x, y, from: [x0, y0], gap, aspect, right, bottom }) {
  if (!loose.length) return { right, bottom };
  const size = ({ isle: { rect: [l, t, r, b] } }) => [r - l, b - t];
  const area = loose.reduce((s, i) => ((w, h) => s + (w + gap) * (h + gap))(...size(i)), 0);
  const wide = Math.max(...loose.map((i) => size(i)[0]), aspect > 0 ? Math.sqrt(area * aspect) : 0);
  let cx = x0, cy = y0, shelf = 0;
  for (const i of loose) {
    const [w, h] = size(i);
    if (cx > x0 && cx + w > x0 + wide) (cx = x0), (cy += shelf + gap), (shelf = 0);
    const [dx, dy] = [cx - i.isle.rect[0], cy - i.isle.rect[1]];
    for (const n of i.items) if (x.has(n.id)) x.set(n.id, x.get(n.id) + dx), y.set(n.id, y.get(n.id) + dy);
    const { isle } = i, [l, t, r, b] = isle.rect;
    isle.rect = [l + dx, t + dy, r + dx, b + dy];
    isle.land = isle.land.map((p) => ({ l: p.l + dx, t: p.t + dy, r: p.r + dx, b: p.b + dy }));
    if (isle.canvas) isle.canvas = { ...isle.canvas, at: [isle.canvas.at[0] + dx, isle.canvas.at[1] + dy] };
    if (isle.look) isle.look = { ...isle.look, at: [isle.look.at[0] + dx, isle.look.at[1] + dy] };
    (right = Math.max(right, cx + w)), (bottom = Math.max(bottom, cy + h));
    (cx += w + gap), (shelf = Math.max(shelf, h));
  }
  return { right, bottom };
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
