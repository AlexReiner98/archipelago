// The layout of a map (hub e_9uhaqhwe), since the solver went (17 Nov 2026): a view that lists its islands draws them
// where agents placed them (./placed.js); any other picture is placed plainly, each island's items in rows, wired straight,
// until the canvas draws only placed islands. This module reads the kit's graph and answers the model the flow's scene
// draws. Layer: metrics. Pure: the layout's args in, the model out.

import { finish } from './land.js';
import { model } from './model.js';
import { placedOut, straight } from './placed.js';
import { stage } from './stage.js';

export { stages } from './stage.js';

/**
 * A picture with no places, placed plainly: each island's boxes in rows inside its frame, the islands side by side in
 * shelves toward the picture's shape, and every link a straight wire, as a placed view draws it.
 */
function plainly(args, m, islandOf, heads, wides = new Map(), follows = new Map()) {
  const { sizes } = args, GAP = sizes.flow_node_gap, PAD = sizes.flow_island_pad, SEA = sizes.flow_island_sea, M = sizes.flow_margin, RISE = args.rise ?? 0;
  const groups = new Map();
  for (const [id, n] of m.nodes) (groups.get(islandOf(id) ?? null) ?? groups.set(islandOf(id) ?? null, []).get(islandOf(id) ?? null)).push(n);
  const made = [...groups].map(([island, list]) => {
    const cw = Math.max(...list.map((n) => n.w)) + GAP, ch = Math.max(...list.map((n) => n.h)) + GAP, columns = Math.max(1, Math.round(Math.sqrt(list.length * ch / cw * 2)));
    const rows = Math.ceil(list.length / columns), pad = island === null ? 0 : PAD, top = pad + (island === null ? 0 : heads.get(island) ?? 0);
    return { island, list, cw, ch, columns, top, pad, w: Math.max(wides.get(island) ?? 0, Math.min(columns, list.length) * cw - GAP + 2 * pad), h: top + rows * ch - GAP + pad };
  });
  // An island that follows another (a pack's parts, the island they are of) is shelved right after it.
  const blocks = made.filter((b) => !follows.has(b.island)).flatMap((b) => [b, ...made.filter((f) => follows.get(f.island) === b.island)]);
  blocks.push(...made.filter((b) => follows.has(b.island) && !blocks.includes(b)));
  // Shelves as wide as the whole would be at the picture's shape.
  const area = blocks.reduce((s, b) => s + (b.w + SEA) * (b.h + SEA), 0), wide = Math.max(...blocks.map((b) => b.w), Math.sqrt(area * (args.aspect ?? 1.6)));
  const x = new Map(), y = new Map(), islands = [];
  let cx = M, cy = M + RISE, shelf = 0;
  for (const b of blocks) {
    if (cx > M && cx + b.w > M + wide) (cx = M), (cy += shelf + SEA + RISE), (shelf = 0);
    b.list.forEach((n, k) => {
      x.set(n.id, cx + b.pad + (k % b.columns) * b.cw + n.w / 2);
      y.set(n.id, cy + b.top + Math.floor(k / b.columns) * b.ch + n.h / 2);
    });
    if (b.island !== null) islands.push({ id: b.island, rect: [cx, cy, cx + b.w, cy + b.h], land: [{ l: cx, t: cy, r: cx + b.w, b: cy + b.h }] });
    cx += b.w + SEA;
    shelf = Math.max(shelf, b.h);
  }
  return { m, nodes: m.nodes, x, y, ...straight(m, x, y, sizes), islands, ports: [] };
}

/**
 * The whole picture of `args` (as the flow's layout is given them): `islandOf(id)` where a step lives, `heads(island)`
 * how tall its name and legend stand over what it holds, `wides` how wide its header is (its frame is at least as wide). Answers the model's `x`, `y`, `nodes`, `chains` and `ties`,
 * and each island's frame.
 */
export function laidOut(args, { islandOf = () => null, heads = new Map(), wides = new Map(), follows = new Map() } = {}) {
  const m = model(args);
  // A view that lists its islands draws them where agents placed them (./placed.js).
  if ((args.placed || args.looks?.size || args.focusAt?.size) && m.nodes.size) return placedOut(args, m, islandOf, heads, wides);
  return plainly(args, m, islandOf, heads, wides, follows);
}

/** The model the flow's scene draws: the whole picture with no islands, or the kit's plain graph when only that is asked. */
export function layout(args) {
  if (args.extras?.plain) {
    const m = model(args);
    return { all: [...m.nodes.values()], chains: m.chains, ties: m.ties, potential: m.potential, breaks: [], args };
  }
  const a = laidOut(args);
  const done = finish({ nodes: a.nodes, x: a.x, y: a.y, chains: a.chains, ties: a.ties, potential: a.m.potential, margin: args.sizes.flow_margin });
  stage('finish', { chains: done.chains.map((w) => w.points), ties: done.ties.map((w) => w.points) });
  return Object.assign(done, { raw: { args } });
}
