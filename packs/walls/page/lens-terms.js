// The lens algebra, a runtime service (task e_926g89jb): a query's terms told apart, said in words, and the lens with
// one added or taken out. A part imports none of it: it names a term to add (`tools.go({ add: { find: term } })`) or take
// out (`{ take: { part, value } }`) and the runtime makes the lens (packs/surface/page/canvas.js, hooks.go), and every
// lens handed to a part carries `said`, the lens in a few words (packs/surface/page/part-lens.js). Plain: it reads no
// page and asks nothing, so the page's modules and the tests use the same code.

/** Only's plain words (decision e_xe5dx55e), told from a type, as the server reads them (packs/query/kernel/query-only.ts). */
export const isWord = (term) => /^(done|blocked|no owner|over estimate|by owner|by agent)$|^(status|(?:changed|made) (?:since|before))\s+\S/i.test(String(term).trim());
export const isId = (s) => /^e_[a-z0-9]{8}$/.test(s);
/** What Not leaves out: the system's own, unless the lens says otherwise. */
export const notOf = (filter) => filter?.not ?? ['kind system'];
/** Find's words: its `text` terms. */
export const wordsOf = (filter) => (filter?.find ?? []).filter((t) => t.startsWith('text ')).map((t) => t.slice(5));
/** The ids a filter names, wherever a term ends at one. */
export const idsNamed = (filter) => [...new Set(['find', 'only', 'not'].flatMap((p) => filter?.[p] ?? []).map((t) => /\b(e_[a-z0-9]{8})$/.exec(t)?.[1]).filter(Boolean))];

/** A walked link's way, read off how the lens writes it. */
export const wayOf = (term) => {
  const way = term.endsWith('>') ? 'out' : term.endsWith('<') ? 'in' : 'either';
  return { link: way === 'either' ? term : term.slice(0, -1), way };
};
const ARROW = { either: '↔', out: '→', in: '←' };

/** What sort of term a term is, as the bar marks and orders them. */
export function sortOf(t) {
  const [head] = /^\S+/.exec(t) ?? [''];
  if (isWord(t)) return 'word';
  if (t === 'held') return 'held';
  if (t === 'moved') return 'moved';
  if (['text', 'type', 'kind', 'id', 'in', 'related', 'owner'].includes(head)) return head;
  return 'link';
}
const ORDER = ['held', 'moved', 'text', 'type', 'kind', 'link', 'owner', 'related', 'id', 'in', 'word'];
export const inOrder = (list) => [...list].sort((a, b) => ORDER.indexOf(sortOf(a)) - ORDER.indexOf(sortOf(b)));

/**
 * The words a lens's terms are said in: `words` the schema's ({ types: { id: { title } }, links: { id: title } }),
 * `names` the titles of the items it names (an object or a Map). An item not named is "an item".
 */
export function namer(words, names = {}) {
  const named = names instanceof Map ? names : new Map(Object.entries(names ?? {}));
  const typeTitle = (id) => words?.types?.[id]?.title ?? id;
  const linkTitle = (id) => words?.links?.[id] ?? id.replaceAll('_', ' ');
  const nameOf = (id) => named.get(id) ?? 'an item';
  const end = (rest) => (rest === 'me' ? 'me' : isId(rest) ? nameOf(rest) : rest);
  const termSaid = (t) => {
    const sort = sortOf(t);
    const rest = t.slice(t.indexOf(' ') + 1);
    if (sort === 'held') return 'held for you';
    if (sort === 'moved') return 'finding moved';
    if (sort === 'text') return `“${rest}”`;
    if (sort === 'type') return typeTitle(rest);
    if (sort === 'kind') return rest;
    if (sort === 'id') return nameOf(rest);
    if (sort === 'in') return `in ${end(rest)}`;
    if (sort === 'related') return `related to ${end(rest)}`;
    if (sort === 'owner') return `owner ${end(rest)}`;
    if (sort === 'word') return t;
    const [, link, to] = /^(\S+)\s+(.+)$/.exec(t) ?? [null, t, ''];
    return `${linkTitle(link)} ${end(to)}`;
  };
  const waySaid = (t) => ((w) => `${ARROW[w.way]} ${linkTitle(w.link)}`)(wayOf(t));
  return { typeTitle, linkTitle, nameOf, termSaid, waySaid };
}

/** What the filter finds, in a few words: each sort of term once, a second of the same counted ("is part of Server +3"). */
export function filterSaid(f, said) {
  const count = { type: (l) => `${l.length} types`, id: (l) => `${l.length} items`, in: (l) => `in ${l.length} items` };
  const groups = new Map();
  for (const t of inOrder(f?.find ?? []).filter((x) => sortOf(x) !== 'text')) {
    const key = sortOf(t) === 'link' ? /^\S+/.exec(t)[0] : sortOf(t);
    (groups.get(key) ?? groups.set(key, []).get(key)).push(t);
  }
  const only = f?.only ?? [];
  return [
    ...wordsOf(f).map((w) => `“${w}”`),
    ...[...groups.entries()].map(([key, l]) => (l.length === 1 ? said(l[0]) : (count[key]?.(l) ?? `${said(l[0])} +${l.length - 1}`))),
    only.length > 0 && `only ${said(only[0])}${only.length > 1 ? ` +${only.length - 1}` : ''}`,
  ].filter(Boolean).join(' · ');
}

const PARTS = ['find', 'only', 'not'];
const TERM = (t) => typeof t === 'string' && t.length > 0 && t.length <= 300 && !/[\n\r]/.test(t);

/** The lens with one term added to the part it is for: { find }, { only } or { not }. */
export function added(lens, term) {
  const f = { ...lens.filter };
  for (const part of PARTS) if (term[part]) f[part] = [...new Set([...(part === 'not' ? notOf(f) : (f[part] ?? [])), term[part]])];
  // Only what is done finds nothing while Not leaves the done out: it takes that away.
  if (term.only === 'done' && f.not?.includes('done')) f.not = f.not.filter((x) => x !== 'done');
  // A term added to a lens that names a view makes it a filter of the map again.
  const { view: _view, ...rest } = lens;
  return { ...rest, filter: f };
}

/** The lens with one of its filter's terms taken out. */
export function without(lens, part, value) {
  const f = { ...lens.filter };
  f[part] = (part === 'not' ? notOf(f) : (f[part] ?? [])).filter((v) => v !== value);
  if (part !== 'not' && !f[part].length) delete f[part];
  return { ...lens, filter: f };
}

/**
 * The lens a part's `go` names relative to the one up (`lens`): `{ add: { find|only|not: term } }` or
 * `{ take: { part, value } }`. Null when it names neither, or names it wrongly: a part's words are checked here.
 */
export function moved(lens, { add, take } = {}) {
  if (add && typeof add === 'object') {
    const term = Object.fromEntries(PARTS.filter((p) => add[p] !== undefined).map((p) => [p, add[p]]));
    const said = Object.values(term);
    return said.length && said.every(TERM) ? added(lens, term) : null;
  }
  if (take && typeof take === 'object') return PARTS.includes(take.part) && TERM(take.value) ? without(lens, take.part, take.value) : null;
  return null;
}
