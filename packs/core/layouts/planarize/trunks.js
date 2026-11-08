// Wires that share a trunk (task e_snvzsxj4): of one link type, all into one end or all out of it, and all running the
// same way (all down, or all turned and up), never mixed. Each such set of two or more becomes a junction on a stem from
// the end they share, a branch to each. Where they go to other islands, the trunk holds as one across each shore: a
// junction on the shared end's island, one at sea where it reaches more than one island, and one on each island it
// reaches twice or more, so a trunk crosses a shore once. Layer: graph. Pure: wires in, wires out.

/** The key of the trunk a wire could join at its end `end` ('u' or 'v'), or null where it can join none. */
const keyOf = (w, end) => (w.directed && w.types.length === 1 ? `${w.types[0]}|${w[end]}|${end}|${w.turned ? 'up' : 'down'}` : null);

/**
 * The trunks of `wires` (of ./direct.js, with their ways): each set of two or more wires that may share one, the
 * largest first, the shared end made first of equals; no wire in two. Answers [{ end, side, wires }], `side` saying
 * which end of each wire (u or v) the trunk leaves from.
 */
export function trunksOf(wires, made) {
  const used = new Set(), found = [];
  for (;;) {
    const sets = new Map();
    for (const w of wires) if (!used.has(w)) for (const end of ['u', 'v']) {
      const key = keyOf(w, end);
      if (key) (sets.get(key) ?? sets.set(key, { end: w[end], side: end, wires: [] }).get(key)).wires.push(w);
    }
    const best = [...sets.values()].filter((s) => s.wires.length > 1).sort((p, q) => q.wires.length - p.wires.length || made(p.end) - made(q.end) || (p.side < q.side ? -1 : 1))[0];
    if (!best) return found;
    best.wires.forEach((w) => used.add(w));
    found.push(best);
  }
}

/**
 * The wires with each trunk made of junctions: a trunk's wires give way to its stretches, each a wire of the trunk's
 * type and way (`trunk` its number), from the shared end through its junctions to each far end. `islandOf(id)` says
 * where a step lives (null at sea); answers the wires and the junctions, each { id, island, trunk, end }.
 */
export function withTrunks(wires, made, islandOf) {
  const trunks = trunksOf(wires, made), inTrunk = new Set(trunks.flatMap((t) => t.wires)), out = wires.filter((w) => !inTrunk.has(w)), junctions = [];
  trunks.forEach((t, k) => {
    const first = t.wires[0], far = t.side === 'u' ? 'v' : 'u', home = islandOf(t.end);
    const junction = (island, tag) => {
      const j = { id: `junction ${k}${tag}`, island, trunk: k, end: t.end };
      junctions.push(j);
      return j.id;
    };
    // A tree from the shared end: each node its children, which are far ends or junctions.
    const groups = new Map();
    for (const w of t.wires) {
      const at = islandOf(w[far]) ?? null;
      (groups.get(at) ?? groups.set(at, []).get(at)).push(w);
    }
    const branch = (island, list) => (list.length > 1 ? { id: junction(island, `:${island ?? 'sea'}`), kids: list.map((w) => ({ id: w[far], wire: w })) } : { id: list[0][far], wire: list[0] });
    const abroad = [...groups].filter(([at]) => at !== home).map(([at, list]) => branch(at, list));
    const near = (groups.get(home) ?? []).map((w) => ({ id: w[far], wire: w }));
    const across = home !== null && abroad.length > 1 ? [{ id: junction(null, ':sea'), kids: abroad }] : abroad;
    const tree = { id: t.end, kids: [{ id: junction(home, ''), kids: [...near, ...across] }] };
    // A junction with one child is no junction: its child is joined to its parent.
    const pruned = (node) => {
      if (!node.kids) return node;
      const kids = node.kids.map(pruned);
      if (kids.length === 1 && node.id.startsWith('junction ')) {
        junctions.splice(junctions.findIndex((j) => j.id === node.id), 1);
        return kids[0];
      }
      return { ...node, kids };
    };
    const lay = (node) => {
      for (const kid of node.kids ?? []) {
        const [u, v] = t.side === 'u' ? [node.id, kid.id] : [kid.id, node.id];
        out.push({ id: `t${k}:${out.length}`, u, v, top: first.turned ? v : u, foot: first.turned ? u : v, types: first.types, order: first.order, directed: true, turned: first.turned, trunk: k, links: kid.wire ? kid.wire.links : [] });
        lay(kid);
      }
    };
    lay({ id: t.end, kids: tree.kids.map(pruned) });
  });
  return { wires: out, junctions, trunks: trunks.length };
}
