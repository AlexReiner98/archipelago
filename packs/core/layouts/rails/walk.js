// The walk's order: every item of the answer a stop, read in the view's order. Layer: graph. Pure: items and links in,
// the order out.
//
// The order is the answer's own, put right by the order of the work: what an item depends on (depends_on) is read
// before it, so a walk never reaches a step before what it rests on. A field `order` an item carries (a number) comes
// first of all, where the view's author set one. A ring in the order is read as the answer gives it.

/** The link type whose order the walk keeps. */
export const ORDER = 'depends_on';

const rank = (i) => (typeof i.fields?.order === 'number' ? i.fields.order : typeof i.props?.order === 'number' ? i.props.order : undefined);

/** Whether a link is of `type` or a flavour of it (`is`, nearest first). */
const isOf = (link, type) => link.type === type || (Array.isArray(link.is) && link.is.includes(type));

/** The items in the walk's order: by `order` where set, then before what depends on them, then as the answer gives them. */
export function readingOrder(items, links) {
  const at = new Map(items.map((i, k) => [i.id, k]));
  const given = (a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    if (ra !== undefined || rb !== undefined) return ra === undefined ? 1 : rb === undefined ? -1 : ra - rb || at.get(a.id) - at.get(b.id);
    return at.get(a.id) - at.get(b.id);
  };
  const before = new Map(items.map((i) => [i.id, new Set()]));
  for (const l of links) if (isOf(l, ORDER) && at.has(l.from) && at.has(l.to) && l.from !== l.to) before.get(l.from).add(l.to);
  // Each in the given order, what it rests on read just before it (in the given order too); a ring is cut where met.
  const sorted = [...items].sort(given), byId = new Map(items.map((i) => [i.id, i])), out = [], seen = new Set();
  const visit = (i) => {
    if (seen.has(i.id)) return;
    seen.add(i.id);
    for (const id of [...before.get(i.id)].sort((p, q) => given(byId.get(p), byId.get(q)))) visit(byId.get(id));
    out.push(i);
  };
  for (const i of sorted) visit(i);
  return out;
}
