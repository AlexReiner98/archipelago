// A stand-in for the shared kit's model (task e_7v52ek3c), until it lands: a lens's answer as items { id, w, h, island,
// made }, links { id, from, to, type, order } and islands, each item's size from `sizes(items, links)` (the flow's
// stepsOf, offline). Only the offline replay (scripts/cola-replay.ts) uses it; the kit's model replaces it.

/** The model of an answer. `sizes` answers each item's { w, h } (and what else a drawing of it keeps) by id. */
export function modelOf(answer, sizes) {
  const items = answer.items ?? [], ids = new Set(items.map((i) => i.id));
  const links = (answer.links ?? []).filter((l) => ids.has(l.from) && ids.has(l.to));
  const rank = new Map([...items].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || (a.id < b.id ? -1 : 1)).map((i, n) => [i.id, n]));
  const sized = sizes(items, links);
  return {
    items: items.map((i) => ({ ...sized.get(i.id), id: i.id, title: i.title, island: i.island ?? null, made: rank.get(i.id) })),
    links: links.map((l) => ({ id: l.id, from: l.from, to: l.to, type: l.type, order: l.type === 'depends_on' })),
    islands: (answer.islands ?? []).map((i) => ({ id: i.id, title: i.title })),
  };
}
