// A trunk's junction drawn as a bar (task e_7vp7udzk): step 1 makes one junction for a whole trunk, with its stem and
// every branch round it; on a grid a point has four sides, so a junction of more than three is drawn out as a bar,
// level across the stem, the stem meeting it on one side and the branches leaving it from the other and its two ends,
// in the order the rotation has them. Each point of the bar is a T. The branches' wires run along the bar from the stem,
// so a trunk is drawn as one. Layer: shape. Pure: an embedding in, the same with its bars.

/** The embedding with every junction of more than three ends drawn out as a bar of junctions of three. */
export function barred(emb) {
  const edges = emb.edges.map((e) => ({ ...e })), byId = new Map(edges.map((e) => [e.id, e]));
  const nodes = emb.nodes.map((n) => ({ ...n })), rotation = { ...emb.rotation }, wires = emb.wires.map((w) => ({ ...w, edges: [...w.edges] }));
  const wireOf = new Map();
  for (const w of wires) for (const id of w.edges) wireOf.set(id, w);
  for (const n of emb.nodes) {
    const ring = emb.rotation[n.id] ?? [];
    if (n.kind !== 'junction' || ring.length <= 2 + 1) continue;
    // The stem is the one end whose way through the junction differs from the rest's.
    const out = ring.map((id) => byId.get(id).from === n.id), odd = out.findIndex((o) => out.filter((x) => x === o).length === 1);
    const at = Math.max(odd, 0), [stem, ...branches] = [...ring.slice(at), ...ring.slice(0, at)], k = branches.length;
    // Clockwise from the stem: the far end of the bar, the branches off its other side back along it, its near end.
    const mids = branches.slice(1, k - 1), split = Math.floor(mids.length / 2);
    const path = [...mids.slice(0, split).map((b, i) => `${n.id} @${i}`), n.id, ...mids.slice(split).map((b, i) => `${n.id} @${split + i}`)];
    const hangs = [...mids.slice(0, split), null, ...mids.slice(split)];
    const bar = path.slice(1).map((to, i) => ({ id: `${n.id} bar ${i}`, from: path[i], to, wire: `${n.id} bar`, dir: 'none', bar: true }));
    for (const b of bar) { edges.push(b); byId.set(b.id, b); }
    const own = (id, p) => { const e = byId.get(id); if (e.from === n.id) e.from = p; else e.to = p; };
    path.forEach((p, i) => {
      const right = i === 0 ? branches[0] : bar[i - 1].id, left = i === path.length - 1 ? branches[k - 1] : bar[i].id;
      rotation[p] = hangs[i] === null ? [stem, right, left] : [right, hangs[i], left];
      if (p !== n.id) nodes.push({ id: p, kind: 'junction', w: 0, h: 0, ...(n.island != null && { island: n.island }) });
      nodes.find((x) => x.id === p).bar = [right, left];
    });
    own(stem, n.id);
    own(branches[0], path[0]);
    own(branches[k - 1], path.at(-1));
    mids.forEach((b, i) => own(b, path[i < split ? i : i + 1]));
    // Each branch's wire runs along the bar from the stem to where it leaves.
    const stemAt = path.indexOf(n.id), leaves = new Map([[branches[0], 0], [branches[k - 1], path.length - 1], ...mids.map((b, i) => [b, i < split ? i : i + 1])]);
    for (const [id, p] of leaves) {
      const w = wireOf.get(id);
      if (!w || p === stemAt) continue;
      const run = p < stemAt ? bar.slice(p, stemAt).map((b) => b.id).reverse() : bar.slice(stemAt, p).map((b) => b.id);
      const i = w.edges.indexOf(id), first = i === 0 && (w.edges.length === 1 ? byId.get(id).from === path[p] : !touches(byId.get(w.edges[1]), path[p]));
      w.edges.splice(first ? 0 : i + 1, 0, ...(first ? run : [...run].reverse()));
    }
  }
  return { ...emb, nodes, edges, wires, rotation };
}

const touches = (e, id) => e.from === id || e.to === id;
