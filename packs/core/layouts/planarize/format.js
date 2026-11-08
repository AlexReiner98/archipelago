// The embedding as step 2 takes it (task e_7vp7udzk, "Its input: the embedding"): plain data of nodes, edges (each a
// piece of one wire), wires, the rotation round each node and the faces, both by edge, and each island's border.
// Unseen edges (what keeps the graph in one piece) are wires of type `unseen`, and each border's arcs a wire of type
// `border`: both hold the faces as they are, and neither is drawn. The rotation is read off the plain drawing
// (./plain.js), so it turns clockwise on the page and the faces walk it. Layer: metrics. Pure: an embedding in, data out.

import { isBorder } from './line.js';
import { clockwise, traced, visibility } from './plain.js';
import { pair } from './polyline.js';

/** The kind of a node: an item, a junction, a border point, or a point where a wire crosses a wire or a border. */
function kindOf(v, e, m) {
  if (m.nodes.has(v)) return 'item';
  if (v.startsWith('junction ')) return 'junction';
  if (isBorder(v)) return 'border';
  return e.portAt.has(v) ? 'port' : 'cross';
}

/**
 * `e` of ./embedding.js over the kit's graph `m`, as step 2's input: rotation and borders clockwise on the page (y
 * down), each border from its island's top; faces walked by the rotation, `outer` the one round everything.
 */
export function asInput(e, m) {
  const vis = visibility(e), round = clockwise(e, vis), { faces: walked, outer } = traced(round, e, vis);
  const wireOf = new Map(), wires = [], edges = [], edgeOf = new Map();
  for (const w of e.owner.values()) if (!wireOf.has(w)) {
    const of = w.link?.wire, id = of ? of.id : w.link?.border !== undefined ? `border ${w.link.border} ${w.link.side}` : `unseen ${wireOf.size}`;
    wireOf.set(w, id);
    const own = [];
    w.path.slice(1).forEach((b, k) => {
      const a = w.path[k], edge = { id: `${id}:${k}`, from: a, to: b, wire: id, dir: of?.directed ? (of.turned ? 'up' : 'down') : 'none' };
      edges.push(edge);
      edgeOf.set(pair(a, b), edge.id);
      own.push(edge.id);
    });
    const types = of ? of.types : [w.link?.border !== undefined ? 'border' : 'unseen'];
    wires.push({
      id, link: of?.links[0] ? `${of.links[0].type} ${of.links[0].a} ${of.links[0].b}` : null, type: types[0], types, edges: own, reversed: Boolean(of?.turned),
      ...(of?.trunk !== undefined && { trunk: of.trunk }),
    });
  }
  const nodes = [...round.keys()].map((id) => {
    const n = m.nodes.get(id), kind = kindOf(id, e, m), island = kind === 'port' ? e.portAt.get(id).island : kind === 'border' ? id.slice(id.indexOf(' ') + 1) : e.place.get(id);
    return { id, kind, w: n?.w ?? 0, h: n?.h ?? 0, ...(island != null && { island }) };
  });
  const rotation = Object.fromEntries([...round].map(([v, ring]) => [v, ring.map((w) => edgeOf.get(pair(v, w)))]));
  const faces = walked.map((f) => f.map((v, k) => edgeOf.get(pair(v, f[(k + 1) % f.length]))));
  // A face is walked with itself on the right, as a loop is walked clockwise round its inside: a border runs clockwise
  // when the face on the right of its first stretch holds what lives on its island.
  const rightOf = new Map();
  walked.forEach((f) => f.forEach((v, k) => rightOf.set(`${v} ${f[(k + 1) % f.length]}`, f)));
  const inside = (f, island) => (f ?? []).some((v) => e.place.get(v) === island && !isBorder(v));
  const islands = [...e.borders].map(([id, ring]) => ({ id, border: inside(rightOf.get(`${ring[0]} ${ring[1]}`), id) ? ring : [ring[0], ...ring.slice(1).reverse()] }));
  return { nodes, edges, wires, rotation, faces, outer, islands };
}
