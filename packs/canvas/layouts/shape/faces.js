// The faces of an embedding (task e_7vp7udzk), read off its rotation alone: each edge is two darts, one each way, and a
// face is the darts met by turning, at each node, to the edge after the one come in by, clockwise round it. So a face
// lies on the left of each of its darts; on a screen, where y runs down, an inner face is walked counterclockwise.
// Layer: shape. Pure: the embedding in, its darts and faces out.

/**
 * The darts and faces of `emb` ({ nodes, edges, rotation, faces?, outer? }). Dart 2k runs edge k from `from` to `to`,
 * 2k + 1 back; `outerDart` ({ edge, from }), where given, names the outer face by a dart along it. Answers { edgeAt, nodeAt, tail, head, next, faceOf, faces, outerOf, component, components }: `faces` a
 * list of dart lists, `outerOf` the outer face of each component, by index.
 */
export function facesOf(emb) {
  const edgeAt = new Map(emb.edges.map((e, k) => [e.id, k])), nodeAt = new Map(emb.nodes.map((n, k) => [n.id, k]));
  const D = emb.edges.length * 2, tail = new Int32Array(D), head = new Int32Array(D), next = new Int32Array(D).fill(-1);
  emb.edges.forEach((e, k) => {
    const a = nodeAt.get(e.from), b = nodeAt.get(e.to);
    if (a === undefined || b === undefined) throw new Error(`shape: edge ${e.id} ends at a node not in the embedding`);
    if (a === b) throw new Error(`shape: edge ${e.id} is a loop`);
    tail[k * 2] = a; head[k * 2] = b; tail[k * 2 + 1] = b; head[k * 2 + 1] = a;
  });
  /** The dart leaving node `v` along edge `k`. */
  const leaving = (v, k) => (tail[k * 2] === v ? k * 2 : k * 2 + 1);
  emb.nodes.forEach((n, v) => {
    const ring = (emb.rotation[n.id] ?? []).map((id) => {
      const k = edgeAt.get(id);
      if (k === undefined || (tail[k * 2] !== v && head[k * 2] !== v)) throw new Error(`shape: the rotation of ${n.id} names ${id}, not one of its edges`);
      return k;
    });
    ring.forEach((k, i) => { next[leaving(v, k) ^ 1] = leaving(v, ring[(i + 1) % ring.length]); });
  });
  for (let d = 0; d < D; d++) if (next[d] < 0) throw new Error(`shape: edge ${emb.edges[d >> 1].id} is missing from a rotation`);
  const faceOf = new Int32Array(D).fill(-1), faces = [];
  for (let d = 0; d < D; d++) {
    if (faceOf[d] >= 0) continue;
    const f = [];
    for (let x = d; faceOf[x] < 0; x = next[x]) { faceOf[x] = faces.length; f.push(x); }
    faces.push(f);
  }
  // Components, by the edges between nodes; a node with none is a component of its own, with no face.
  const root = emb.nodes.map((_, v) => v), find = (v) => (root[v] === v ? v : (root[v] = find(root[v])));
  for (let d = 0; d < D; d += 2) root[find(tail[d])] = find(head[d]);
  const component = emb.nodes.map((_, v) => find(v)), components = [...new Set(component)];
  const outerOf = new Map();
  const given = emb.faces && emb.outer !== undefined && emb.faces[emb.outer];
  const named = emb.outerDart ? faceOf[leaving(nodeAt.get(emb.outerDart.from), edgeAt.get(emb.outerDart.edge))] : given ? faces.findIndex((f) => sameFace(f, given, emb, head)) : -1;
  for (const c of components) {
    const mine = faces.map((_, i) => i).filter((i) => component[tail[faces[i][0]]] === c);
    if (!mine.length) continue;
    if (named >= 0 && mine.includes(named)) outerOf.set(c, named);
    else outerOf.set(c, mine.reduce((best, i) => (faces[i].length > faces[best].length ? i : best), mine[0]));
  }
  return { edgeAt, nodeAt, tail, head, next, faceOf, faces, outerOf, component, components, leaving };
}

/**
 * Whether dart list `f` is the face `given` names: a list of edge ids or of node ids walked round it with the face on
 * its right, as step 1 walks them, the other way from these darts. Of two faces with the same edges (a ring's inside
 * and outside), the one walked that way.
 */
function sameFace(f, given, emb, head) {
  const edges = f.map((d) => emb.edges[d >> 1].id).reverse(), nodes = f.map((d) => emb.nodes[head[d]].id).reverse();
  const turns = (a, b) => a.length === b.length && a.some((_, s) => b.every((x, i) => x === a[(s + i) % a.length]));
  for (const mine of [edges, nodes]) if (turns(mine, given)) return true;
  return false;
}
