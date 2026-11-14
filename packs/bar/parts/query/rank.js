// What a picker offers first (task e_css8swr9): the types and link types this canvas uses, then those used one step
// around it, then the rest, as the registry lists them. What the owner retired, or a pack no longer defines, is never
// offered. Plain: handed the definitions and what is drawn, it answers the order; the query bar asks what is around.

/** How often each type and each link type is used, by these items and links. */
export function uses(items, links) {
  const count = (list) => list.reduce((m, x) => m.set(x.type, (m.get(x.type) ?? 0) + 1), new Map());
  return { types: count(items ?? []), links: count(links ?? []) };
}

/** What is used around a canvas: in the wider answer, the items and links the canvas does not draw. */
export function around(drawn, wider) {
  const items = new Set((drawn.items ?? []).map((i) => i.id));
  const links = new Set((drawn.links ?? []).map((l) => l.id));
  return uses((wider.items ?? []).filter((i) => !items.has(i.id)), (wider.links ?? []).filter((l) => !links.has(l.id)));
}

/**
 * The definitions a picker offers, in order: those used here (the most used first), then those used around, then the
 * rest; each with where it is used (`near`: 'here', 'around', or none). Retired and dormant ones are left out.
 */
export function ranked(defs, here = new Map(), near = new Map()) {
  const live = defs.filter((d) => !d.retired && !d.dormant);
  const seen = new Set();
  const by = (m, where) => live.filter((d) => m.has(d.id) && !seen.has(d.id)).sort((a, b) => m.get(b.id) - m.get(a.id)).map((d) => (seen.add(d.id), { ...d, near: where }));
  const first = by(here, 'here');
  const next = by(near, 'around');
  return [...first, ...next, ...live.filter((d) => !seen.has(d.id))];
}
