// A query's terms in words, as the bar says them (was ui/query-bar.js): what sort each term is, the words it goes by,
// the order the bar keeps them in, and the lens with one added or taken out. Plain: handed the schema's words (the
// part's input) and the names it knows of items, it answers words; it reads no page and asks nothing.

import { isWord } from './only-words.js';

export const isId = (s) => /^e_[a-z0-9]{8}$/.test(s);
/** Find's words: its `text` terms. */
export const wordsOf = (filter) => (filter?.find ?? []).filter((t) => t.startsWith('text ')).map((t) => t.slice(5));
/** What Not leaves out: the system's own, unless the lens says otherwise. */
export const notOf = (filter) => filter?.not ?? ['kind system'];

/** A walked link's way, read off how the lens writes it, and written back. */
export const wayOf = (term) => {
  const way = term.endsWith('>') ? 'out' : term.endsWith('<') ? 'in' : 'either';
  return { link: way === 'either' ? term : term.slice(0, -1), way };
};
export const withWay = (link, way) => `${link}${{ out: '>', in: '<' }[way] ?? ''}`;
export const ARROW = { either: '↔', out: '→', in: '←' };
export const NEXT_WAY = { either: 'out', out: 'in', in: 'either' };

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
/** What each sort of term means, for its tip. */
export const MEANT = { held: 'What changes held for you would touch', moved: 'What reads a finding that moved since it was last changed or said still true', text: 'Words in titles and notes', type: 'Items of this type', kind: 'Items of this kind', marked: 'Items with this tag', link: 'Items with this link', owner: 'What this person owns', related: 'What has any link to this item, either way', id: 'This item', in: 'All that is in this item, at any depth', word: 'What is so' };
/** The tone each sort of term is marked by. */
export const TONE = { held: 'warn', moved: 'warn', type: 'accent', kind: 'accent', link: 'ok', owner: 'ok', related: 'ok', word: 'warn' };

/**
 * The words the bar names things by: `words` the schema's ({ types, links }), `names` the items it knows the titles of
 * (a Map). An item it does not know is said as "an item", its id in the tip.
 */
export function namer(words, names = new Map()) {
  const typeTitle = (id) => words?.types?.[id]?.title ?? id;
  const linkTitle = (id) => words?.links?.[id] ?? id.replaceAll('_', ' ');
  const nameOf = (id) => names.get(id) ?? 'an item';
  const end = (rest) => (rest === 'me' ? 'me' : isId(rest) ? nameOf(rest) : rest);
  /** A term in words: an item by its name, a type by its title. */
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
  /** A walked link in words: its way's arrow, then its title. */
  const waySaid = (t) => ((w) => `${ARROW[w.way]} ${linkTitle(w.link)}`)(wayOf(t));
  return { typeTitle, linkTitle, nameOf, termSaid, waySaid };
}

/** What the filter finds, in a few words: each sort of term once, a second of the same counted ("is part of Server +3"). */
export function filterSaid(f, said) {
  const count = { type: (l) => `${l.length} types`, id: (l) => `${l.length} items`, in: (l) => `in ${l.length} items` };
  const groups = new Map();
  for (const t of inOrder(f.find ?? []).filter((x) => sortOf(x) !== 'text')) {
    const key = sortOf(t) === 'link' ? /^\S+/.exec(t)[0] : sortOf(t);
    (groups.get(key) ?? groups.set(key, []).get(key)).push(t);
  }
  const only = f.only ?? [];
  return [
    ...wordsOf(f).map((w) => `“${w}”`),
    ...[...groups.entries()].map(([key, l]) => (l.length === 1 ? said(l[0]) : (count[key]?.(l) ?? `${said(l[0])} +${l.length - 1}`))),
    only.length > 0 && `only ${said(only[0])}${only.length > 1 ? ` +${only.length - 1}` : ''}`,
  ].filter(Boolean).join(' · ');
}

/** The lens with one term added to the part it is for: { find }, { only } or { not }. */
export function added(lens, term) {
  const f = { ...lens.filter };
  for (const part of ['find', 'only', 'not']) if (term[part]) f[part] = [...new Set([...(part === 'not' ? notOf(f) : (f[part] ?? [])), term[part]])];
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
