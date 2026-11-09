// Layer: topology. The rows of an island: only the order sets them. Each order link ties the block of its `to` (above)
// to the block of its `from` (below); a block's row is the longest path of those down to it, and a block that only
// starts paths sits just above the first it starts. In a loop, a link down to a block made earlier is the back edge:
// it sets no row and is drawn up. Links inside one block set nothing. Pure.

const before = (p, q) => (p.made < q.made ? true : p.made > q.made ? false : p.id < q.id);

/** The strongly connected parts of a graph (Tarjan's), each node to the number of its part. */
function partsOf(nodes, next) {
  const index = new Map(), low = new Map(), part = new Map(), stack = [], on = new Set();
  let n = 0, parts = 0;
  const visit = (v) => {
    index.set(v, n), low.set(v, n++), stack.push(v), on.add(v);
    for (const w of next.get(v) ?? []) {
      if (!index.has(w)) (visit(w), low.set(v, Math.min(low.get(v), low.get(w))));
      else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) !== index.get(v)) return;
    let w;
    do (w = stack.pop(), on.delete(w), part.set(w, parts));
    while (w !== v);
    parts++;
  };
  for (const v of nodes) if (!index.has(v)) visit(v);
  return part;
}

/**
 * The blocks no order link touches, in lines under the ordered rows (from row `rows`), made first, each line no wider
 * than `wide`; `widthOf` is a block's width. They have no place in the order, so they wrap as words do.
 */
export function linesOf(blocks, { row, rows, ordered }, widthOf, wide, gap) {
  let line = rows, used = 0;
  for (const b of blocks.filter((v) => !ordered.has(v.id))) {
    const w = widthOf(b);
    if (used > 0 && used + gap + w > wide) (line++, (used = 0));
    row.set(b.id, line);
    used += (used > 0 ? gap : 0) + w;
  }
  return Math.max(rows, ...[...row.values()].map((r) => r + 1));
}

/**
 * Each block's row, from 0 at the top, and which order links are back edges. `ordered` are the blocks an order link
 * touches, and `rows` how many rows they take; the rest are each set at 0 until ./ranks.js linesOf places them. `blockOf` names each item's block; a link
 * whose ends are not both in `blocks` is not this island's to rank.
 */
export function ranksOf(blocks, links, blockOf) {
  const byId = new Map(blocks.map((b) => [b.id, b])), edges = [];
  for (const l of links) {
    if (!l.order) continue;
    const up = blockOf.get(l.to), down = blockOf.get(l.from);
    if (up === undefined || down === undefined || up === down || !byId.has(up) || !byId.has(down)) continue;
    edges.push({ link: l.id, up, down });
  }
  const next = new Map();
  for (const e of edges) (next.get(e.up) ?? next.set(e.up, []).get(e.up)).push(e.down);
  const part = partsOf(blocks.map((b) => b.id), next), back = new Set();
  for (const e of edges) if (part.get(e.up) === part.get(e.down) && before(byId.get(e.down), byId.get(e.up))) back.add(e.link);
  const ahead = edges.filter((e) => !back.has(e.link)), into = new Map(blocks.map((b) => [b.id, 0])), below = new Map();
  for (const e of ahead) (into.set(e.down, into.get(e.down) + 1), (below.get(e.up) ?? below.set(e.up, []).get(e.up)).push(e.down));
  const row = new Map(blocks.map((b) => [b.id, 0])), queue = blocks.filter((b) => into.get(b.id) === 0).map((b) => b.id), done = [];
  while (queue.length) {
    const v = queue.shift();
    done.push(v);
    for (const w of below.get(v) ?? []) {
      row.set(w, Math.max(row.get(w), row.get(v) + 1));
      into.set(w, into.get(w) - 1);
      if (into.get(w) === 0) queue.push(w);
    }
  }
  // A block nothing is above sits just over the nearest block it is above, not at the top of the island.
  const above = new Set(ahead.map((e) => e.down));
  for (const v of [...done].reverse()) {
    const under = below.get(v) ?? [];
    if (!above.has(v) && under.length) row.set(v, Math.min(...under.map((w) => row.get(w))) - 1);
  }
  const ordered = new Set(edges.flatMap((e) => [e.up, e.down]));
  const rows = ordered.size ? Math.max(...[...ordered].map((b) => row.get(b))) + 1 : 0;
  return { row, back, rows, ordered };
}
