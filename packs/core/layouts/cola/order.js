// The order a cola picture keeps (task e_x7kwbu3e): each order link (depends_on) a flow constraint, what is depended on
// above what depends on it. A cycle cannot be kept: the links are taken oldest first (by when the later of their two
// ends was made, then by id), and one that would close a cycle is dropped and said so. Pure: the model in, the order out.

/** Whether `to` is reached from `from` along `below` (each id's list of what is kept below it). */
function reaches(below, from, to) {
  const seen = new Set([from]), todo = [from];
  while (todo.length) {
    const v = todo.pop();
    if (v === to) return true;
    for (const w of below.get(v) ?? []) if (!seen.has(w)) (seen.add(w), todo.push(w));
  }
  return false;
}

/**
 * The order: `kept`, each { above, below, link } with `above` drawn over `below`; `dropped`, the links a cycle made
 * impossible; and `layer`, each item's longest run of kept links from the top (0 for what nothing is above).
 */
export function orderOf({ items, links }) {
  const made = new Map(items.map((i) => [i.id, i.made ?? 0]));
  const ordered = links.filter((l) => l.order && l.from !== l.to && made.has(l.from) && made.has(l.to));
  const when = (l) => Math.max(made.get(l.from), made.get(l.to));
  ordered.sort((a, b) => when(a) - when(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const below = new Map(), kept = [], dropped = [], pairs = new Set();
  for (const l of ordered) {
    // What a link depends on (its `to`) is drawn above it (its `from`).
    const above = l.to, under = l.from, key = `${above} ${under}`;
    if (pairs.has(key)) continue;
    if (reaches(below, under, above)) { dropped.push(l); continue; }
    pairs.add(key);
    (below.get(above) ?? below.set(above, []).get(above)).push(under);
    kept.push({ above, below: under, link: l.id });
  }
  return { kept, dropped, layer: layersOf(items, kept) };
}

/** Each item's longest run of kept links from the top: the row a fixed start puts it on. */
export function layersOf(items, kept) {
  const into = new Map(items.map((i) => [i.id, 0])), after = new Map();
  for (const k of kept) (into.set(k.below, into.get(k.below) + 1), (after.get(k.above) ?? after.set(k.above, []).get(k.above)).push(k.below));
  const layer = new Map(items.map((i) => [i.id, 0]));
  const todo = items.filter((i) => into.get(i.id) === 0).map((i) => i.id);
  while (todo.length) {
    const v = todo.shift();
    for (const w of after.get(v) ?? []) {
      layer.set(w, Math.max(layer.get(w), layer.get(v) + 1));
      into.set(w, into.get(w) - 1);
      if (into.get(w) === 0) todo.push(w);
    }
  }
  return layer;
}
