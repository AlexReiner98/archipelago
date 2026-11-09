// Step 2 of "One layout: planarize, shape, relax" (task e_7vp7udzk): the embedding step 1 made, given a shape at right
// angles with the fewest bends and set on an integer grid, for step 3 to relax. The faces are read off the rotation
// (./faces.js), each box's wires given the sides the order asks for (./sides.js), the angles and bends found by one
// minimum-cost flow (./angles.js, ./flow.js), the shape made a graph of straight stretches with each box a cage
// (./ortho.js) after each node is turned to face its neighbours (./turns.js), its faces cut to rectangles (./refine.js) the grid read off (./compact.js) and drawn tight (./tighten.js).
// Layer: shape. Pure: an embedding in, a sketch out.

import { orthogonal } from './angles.js';
import { barred } from './bars.js';
import { compact } from './compact.js';
import { facesOf } from './faces.js';
import { shaped } from './ortho.js';
import { refine } from './refine.js';
import { tighten } from './tighten.js';
import { necks } from './necks.js';
import { headings } from './turns.js';

/** The sides of a rectangle, by name, as the sketch gives a port's. */
const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];

/** How many times boxes are given necks and the grid read again. */
const ROUNDS = 2;

/** A line's points with every point that does not turn it taken out. */
function corners(points) {
  const out = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    if (out.length >= 2) {
      const a = out.at(-2);
      if ((a[0] === last[0] && last[0] === p[0]) || (a[1] === last[1] && last[1] === p[1])) out.pop();
    }
    out.push(p);
  }
  return out;
}

/**
 * The sketch of `emb` (the embedding of step 1: nodes, edges, wires, rotation, faces, outer, islands): { nodes, wires,
 * islands, ports, bends }, every place in grid units, a box's at its middle, y running down.
 */
export function shape(given) {
  // The outer face is named before the bars go in, by a dart along it that no bar moves.
  const F0 = facesOf(given), outer = F0.faces[[...F0.outerOf.values()][0]] ?? [], wide = new Set(given.nodes.filter((n) => n.kind === 'junction' && (given.rotation[n.id] ?? []).length > 2 + 1).map((n) => n.id));
  const along = outer.find((d) => !wide.has(given.nodes[F0.tail[d]].id) && !wide.has(given.nodes[F0.head[d]].id));
  const unseen = new Set(given.wires.filter((w) => w.type === 'unseen').flatMap((w) => w.edges));
  const emb = { ...barred(given), unseen, ...(along !== undefined && { outerDart: { edge: given.edges[along >> 1].id, from: given.nodes[F0.tail[along]].id } }) };
  const F = facesOf(emb), S = orthogonal(emb, F), H = headings(emb, F, S);
  // Read the grid, give a neck to each wire that stretches its box, and read it again, until none does.
  let g, chain, cage, x, y;
  for (let round = 0; ; round++) {
    ({ g, chain, cage } = shaped(emb, F, S, H));
    refine(g, chain);
    const first = compact(g);
    ({ x, y } = tighten(g, first.x, first.y));
    if (round === ROUNDS || !necks(emb, F, H, g, x, y)) break;
  }
  const at = (p) => [x[p], y[p]];
  const pointOf = new Map(g.what.map((w, p) => [w, p]).filter(([w]) => w.node !== undefined && w.corner === undefined && w.side === undefined).map(([w, p]) => [w.node, p]));
  const nodes = emb.nodes.map((n, v) => {
    if (cage.has(v)) {
      const [tl, , br] = cage.get(v);
      return { id: n.id, kind: n.kind, x: (x[tl] + x[br]) / 2, y: (y[tl] + y[br]) / 2, w: x[br] - x[tl], h: y[br] - y[tl] };
    }
    const p = pointOf.get(v);
    return { id: n.id, kind: n.kind, x: x[p], y: y[p], w: 0, h: 0 };
  });
  const edgeOf = (id) => F.edgeAt.get(id);
  const wires = (emb.wires ?? []).map((w) => {
    const ks = w.edges.map(edgeOf), ends = (k) => [emb.edges[k].from, emb.edges[k].to];
    let here = ks.length > 1 && ends(ks[1]).includes(emb.edges[ks[0]].from) ? emb.edges[ks[0]].to : emb.edges[ks[0]].from;
    const points = [], from = here;
    for (const k of ks) {
      const forward = emb.edges[k].from === here, c = forward ? chain[k] : [...chain[k]].reverse();
      points.push(...c.map(at));
      here = forward ? emb.edges[k].to : emb.edges[k].from;
    }
    return { id: w.id, link: w.link, type: w.type, reversed: !!w.reversed, from, to: here, points: corners(points) };
  });
  const islands = (emb.islands ?? []).map((island) => {
    const loop = new Set(island.border), pts = [];
    emb.edges.forEach((e, k) => { if (loop.has(e.from) && loop.has(e.to)) pts.push(...chain[k].map(at)); });
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { id: island.id, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  const ports = [];
  (emb.islands ?? []).forEach((island, i) => {
    const [x0, y0, x1, y1] = islands[i].rect;
    for (const id of island.border) {
      const n = nodes[F.nodeAt.get(id)];
      if (n.kind !== 'port') continue;
      const side = n.y === y0 ? 0 : n.x === x1 ? 1 : n.y === y1 ? 2 : n.x === x0 ? 2 + 1 : -1;
      ports.push({ id, island: island.id, side: SIDE_NAMES[side] ?? null, at: side % 2 === 0 ? n.x : n.y });
    }
  });
  return { nodes, wires, islands, ports, bends: H.bends, against: S.against || H.bent > 0 };
}
