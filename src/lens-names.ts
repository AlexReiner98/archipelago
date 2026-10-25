// A view kept on the map names types and link types in its flat lens (its filter's types and exclude, its link terms,
// its walk). When a pack takes a type or a link type over (moved_from), the views that named the old one name the new
// one (src/pelago.ts, retype): this says what changes in one view's fields, nothing when nothing does.

type Props = Record<string, unknown>;

/** The fields of a kept view that name `from`, renamed to `to`; empty when it names nothing. */
export function renamedLens(props: Props, from: string, to: string, what: 'entity' | 'relation'): Props {
  const swap = (names: unknown) => (Array.isArray(names) && names.includes(from) ? names.map((n) => (n === from ? to : n)) : undefined);
  const out: Props = {};
  const filter = (props.filter ?? {}) as Props;
  const walk = (props.walk ?? {}) as Props;
  if (what === 'entity') {
    const [types, exclude] = [swap(filter.types), swap(filter.exclude)];
    if (types || exclude) out.filter = { ...filter, ...(types && { types }), ...(exclude && { exclude }) };
    return out;
  }
  const over = swap(walk.over);
  if (over) out.walk = { ...walk, over };
  const term = (t: unknown) =>
    typeof t === 'string' && t.startsWith(`${from} `) ? `${to}${t.slice(from.length)}` : t && typeof t === 'object' && (t as Props).link === from ? { ...(t as Props), link: to } : t;
  if (Array.isArray(filter.links) && filter.links.some((t) => term(t) !== t)) out.filter = { ...filter, links: filter.links.map(term) };
  return out;
}
