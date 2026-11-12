// A view kept on the map names types and link types in its flat lens (its filter's terms,
// its walk). When a pack takes a type or a link type over (moved_from), the views that named the old one name the new
// one (src/pelago.ts, retype): this says what changes in one view's fields, nothing when nothing does.

type Props = Record<string, unknown>;

/** The fields of a kept view that name `from`, renamed to `to`; empty when it names nothing. */
export function renamedQuery(props: Props, from: string, to: string, what: 'entity' | 'relation'): Props {
  const out: Props = {};
  const filter = (props.filter ?? {}) as Props;
  const walk = (props.walk ?? {}) as Props;
  /** Each part of the filter with its terms renamed, none left as it was. */
  const renamed = (term: (t: string) => string) => {
    const parts = (['find', 'only', 'not'] as const).filter((p) => Array.isArray(filter[p]) && (filter[p] as string[]).some((t) => term(t) !== t));
    if (parts.length) out.filter = { ...filter, ...Object.fromEntries(parts.map((p) => [p, (filter[p] as string[]).map(term)])) };
  };
  if (what === 'entity') {
    renamed((t) => (t === from || t === `type ${from}` ? `type ${to}` : t));
    return out;
  }
  // A walked link may say its way (`depends_on>`, `depends_on<`): renamed, it keeps it.
  const named = (n: unknown) => typeof n === 'string' && [from, `${from}>`, `${from}<`].includes(n);
  const over = Array.isArray(walk.over) && walk.over.some(named) ? walk.over.map((n) => (named(n) ? `${to}${(n as string).slice(from.length)}` : n)) : undefined;
  if (over) out.walk = { ...walk, over };
  renamed((t) => (t.startsWith(`${from} `) || t.startsWith(`${from}< `) ? `${to}${t.slice(from.length)}` : t));
  return out;
}
