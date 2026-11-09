// Wires that share a trunk (task e_snvzsxj4): of one link type, all into one end or all out of it, and all running the
// same way (all down, or all turned and up), never mixed. Each such set of two or more becomes a junction on a stem from
// the end they share, a branch to each. Where they go to other islands, the trunk holds as one across each shore: a
// junction on the shared end's island, one at sea where it reaches more than one island, and one on each island it
// reaches twice or more, so a trunk crosses a shore once. Before those, the wires that cross one island's shore the
// same way (task e_3ce5dta5), all into it or all out of it, from one item or many, are joined: they meet at a junction
// on the side they start, cross the shore as one stretch, and fan out from a junction on the far side, so an island
// has one port for each type and way of what crosses it. Layer: graph. Pure: wires in, wires out.


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
 * The wires with their trunks joined: first across each island's shore (`acrossShores`, the wires into an island, then
 * the wires out of one), then of what is left, the trunks that share an end (`byEnd`). `islandOf(id)` says where a step
 * lives (null at sea); answers the wires (each stretch of a trunk with `trunk` its number), the junctions, each
 * { id, island, trunk, end }, and how many trunks.
 */
export function withTrunks(wires, made, islandOf) {
  const junctions = [], into = acrossShores(wires, junctions, made, islandOf, 0, 'v'), outOf = acrossShores(into.wires, junctions, made, islandOf, into.trunks, 'u');
  const joined = smoothed(outOf.wires.filter((w) => w.trunk !== undefined), junctions), rest = byEnd(outOf.wires.filter((w) => w.trunk === undefined), made, islandOf, into.trunks + outOf.trunks, junctions);
  return { wires: [...joined, ...rest.wires], junctions, trunks: into.trunks + outOf.trunks + rest.trunks };
}

/**
 * `wires` with each junction that one stretch enters and one leaves taken out of `junctions`, its two stretches one:
 * where the wires out of an island all go into one other, that island's junction at sea is the other's.
 */
function smoothed(wires, junctions) {
  let out = wires;
  for (const j of [...junctions]) {
    const into = out.filter((w) => w.v === j.id), from = out.filter((w) => w.u === j.id);
    if (into.length !== 1 || from.length !== 1) continue;
    const [a, b] = [into[0], from[0]], one = { ...b, u: a.u, top: b.turned ? b.v : a.u, foot: b.turned ? a.u : b.v, links: [...a.links, ...b.links] };
    out = out.flatMap((w) => (w === a ? [one] : w === b ? [] : [w]));
    junctions.splice(junctions.indexOf(j), 1);
  }
  return out;
}

/**
 * `wires` with each trunk that shares an end made of junctions: a trunk's wires give way to its stretches, each a wire
 * of the trunk's type and way (`trunk` its number, from `from`), from the shared end through its junctions to each far
 * end. Adds the junctions to `junctions`; answers the wires and how many trunks.
 */
function byEnd(wires, made, islandOf, from, junctions) {
  const trunks = trunksOf(wires, made), inTrunk = new Set(trunks.flatMap((t) => t.wires)), out = wires.filter((w) => !inTrunk.has(w));
  trunks.forEach((t, n) => {
    const k = from + n;
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
  return { wires: out, trunks: trunks.length };
}

/**
 * `wires` with each set of two or more of one type and way that cross one island's shore the same way joined: `side`
 * 'v' those that end on the island and start off it, 'u' those that start on it and end off it. They meet at a junction
 * on the side they start, one stretch crosses the shore (from a junction at sea to one on the island, or back), and from
 * the junction on the far side each goes on to its end. Wires from one end share their way to the first junction, and
 * wires to one end their way from the second, and a stretch's links go on the part that reaches its end. Numbers the
 * new trunks from `from` and adds their junctions to `junctions`; answers the wires and how many trunks it made.
 */
export function acrossShores(wires, junctions, made, islandOf, from, side) {
  const placed = new Map(junctions.map((j) => [j.id, j])), placeOf = (id) => (placed.has(id) ? placed.get(id).island : islandOf(id) ?? null);
  const other = side === 'v' ? 'u' : 'v', sets = new Map();
  for (const w of wires) {
    const at = placeOf(w[side]);
    if (!w.directed || w.types.length !== 1 || at === null || placeOf(w[other]) === at) continue;
    const key = `${w.types[0]}|${at}|${w.turned ? 'up' : 'down'}`;
    (sets.get(key) ?? sets.set(key, { island: at, wires: [] }).get(key)).wires.push(w);
  }
  const by = (list, end) => list.reduce((m, w) => m.set(w[end], [...(m.get(w[end]) ?? []), w]), new Map());
  const joined = [...sets.values()].filter((s) => s.wires.length > 1 && (by(s.wires, 'u').size > 1 || by(s.wires, 'v').size > 1));
  const gone = new Set(joined.flatMap((s) => s.wires)), out = wires.filter((w) => !gone.has(w));
  joined.forEach(({ island, wires: list }, n) => {
    const k = from + n, first = list[0], starts = by(list, 'u'), ends = by(list, 'v');
    // What a junction is made after, for the line: the first made of the ends it stands for on the island.
    const end = list.map((w) => (placed.has(w[side]) ? placed.get(w[side]).end : w[side])).sort((p, q) => made(p) - made(q))[0];
    const shore = `junction ${k}:${island}`, sea = `junction ${k}:sea ${island}`, [inId, outId] = side === 'v' ? [sea, shore] : [shore, sea];
    // A junction that one stretch enters and one leaves is none: where one end alone starts or ends, it is the junction.
    const a = starts.size > 1 ? inId : first.u, b = ends.size > 1 ? outId : first.v;
    for (const [id, many] of [[a, starts.size > 1], [b, ends.size > 1]]) if (many) junctions.push({ id, island: id === shore ? island : null, trunk: k, end });
    const stretch = (u, v, of, links) => ({ id: `s${side}${k}:${out.length}`, u, v, top: first.turned ? v : u, foot: first.turned ? u : v, types: first.types, order: first.order, directed: true, turned: first.turned, trunk: of, links });
    if (starts.size > 1) for (const [u, ws] of starts) out.push(stretch(u, a, ws[0].trunk ?? k, []));
    out.push(stretch(a, b, k, ends.size > 1 ? [] : list.flatMap((w) => w.links)));
    if (ends.size > 1) for (const [v, ws] of ends) out.push(stretch(b, v, ws[0].trunk ?? k, ws.flatMap((w) => w.links)));
  });
  return { wires: out, trunks: joined.length };
}
