// A lens answer as a tree, as the page reads one (ui/query-base.js): each thing with what is inside it and what it and
// all inside it say, and how much of a thing stays lit. Layer: graph. Shared by the architecture and the grid.

/** A lens answer as a tree, each thing with what it says of itself and of all that is inside it, in its place. */
export function queryTree(answer) {
  const byId = new Map(answer.items.map((item) => [item.id, { ...item, kids: [] }]));
  const root = { kids: [], title: 'Everything' };
  for (const n of byId.values()) (byId.get(n.inside) ?? root).kids.push(n);
  for (const n of byId.values()) {
    n.you = (n.state.needs_you ? 1 : 0) + (n.within.needs_you ?? 0);
    n.blk = (n.state.blocked ? 1 : 0) + n.within.blocked;
  }
  const sort = (n) => (n.kids.sort((a, b) => a.place - b.place), n.kids.forEach(sort));
  sort(root);
  return { byId, root };
}

/** How much of a thing stays lit: what was asked for by name (style.only), else what the style's lit says. */
export function litCount(n, style) {
  if (Array.isArray(style.only)) {
    const only = new Set(style.only);
    const any = (x) => only.has(x.id) || x.kids.some(any);
    return any(n) ? 1 : 0;
  }
  return style.lit === 'you' ? n.you : style.lit === 'blocked' ? n.blk : 1;
}
