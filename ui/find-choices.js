// What words typed in find could be (decision e_2a4mddx8), each choice said by its kind so nothing is guessed (decision
// e_45sgrfqd). Find has a mode for each part of the lens, by its word: typing "only " (or Not, Walk, Limit) puts find
// in that part, and its choices are that part's. In Find: Words first, always, and lit, so Enter takes the words
// unless another is chosen; then, for the items the search read finds by name, all that is In each and the Item
// itself (a tag as a Tag); the types and the links whose names hold the words (a link to me). In Only: the plain words,
// a Type, Within an item, a Status, an Owner. In Not: closed, system, a Type. In Walk: a link, out, in or either way,
// or every link. In Limit: a number. Each choice says the change it makes, kept by id.

import { api } from './base.js';
import { offered } from './only-words.js';
import { ARROW, relations, titles, typeChoice, typeTitle, types, withWay } from './words.js';

/** The parts find can be in, by the word that puts it there. */
export const MODES = ['Find', 'Only', 'Not', 'Walk', 'Limit'];
const MEANS = { Find: 'What adds to the canvas', Only: 'What must all hold of what Find finds', Not: 'What is left out of everything', Walk: 'The links followed from what Find finds', Limit: 'The most items drawn' };

const has = (name, q) => String(name ?? '').toLowerCase().includes(q.toLowerCase());
const typeList = (q, most) => [...types.values()].filter((t) => !t.system && t.kind !== 'system' && has(t.title, q)).slice(0, most);
const linkList = (q, most) => [...relations.values()].filter((r) => !r.id.startsWith('sys.') && r.id !== 'tagged' && has(r.title ?? r.id, q)).slice(0, most);
const found = async (q, most, type) => (q ? await api('search', { q, limit: most, ...(type && { type }) }).catch(() => []) : []).map((e) => (titles.set(e.id, e.title), e));

/** The words themselves, Find's first choice: drawn at once, before the search answers, so Enter never waits on it. */
export function wordsChoice(q) {
  return { kind: 'Words', label: `“${q}”`, note: '', title: `Words to find in titles and notes: “${q}”`, words: q };
}

/** The other parts whose word starts with what is typed, each a choice that puts find in it. */
const modeChoices = (mode, q) => (q.length < 2 ? [] : MODES.filter((m) => m !== mode && m.toLowerCase().startsWith(q.toLowerCase())))
  .map((m) => ({ kind: m, label: `${MEANS[m].toLowerCase()} ›`, note: '', title: `${m}: ${MEANS[m].toLowerCase()} (type “${m.toLowerCase()} ” to go there)`, mode: m }));

/**
 * The choices for `q` in `mode`, in order: { kind, label, note, title, and one of words, term (added to the filter),
 * walk (a link to follow), limit, mode (find goes into that part) }. `c` is { most, lens }: how many of each are offered,
 * and the lens up, so what it holds already is not offered again.
 */
export async function choicesFor(mode, q, c) {
  const f = c.lens.filter;
  if (mode === 'Find') {
    const items = (await found(q, c.most)).flatMap((e) => {
      const what = typeTitle(e.type);
      if (e.type === 'tag') return [{ kind: 'Tag', label: `#${e.title}`, note: '', title: `Items tagged ${e.title}`, term: { link: `tagged ${e.id}` } }];
      return [
        { kind: 'In', label: e.title, note: what, title: `All that is in ${e.title} (${what}), at any depth`, term: { in: e.id } },
        { kind: 'Item', label: e.title, note: what, title: `${e.title} (${what}) alone`, term: { id: e.id } },
      ];
    });
    const typed = typeList(q, c.most).map((t) => ({ kind: 'Type', label: typeChoice(t), note: '', title: `Items of the type ${t.title}, the newest first`, term: { type: t.id } }));
    const linked = linkList(q, c.most).map((r) => ({ kind: 'Link', label: `${r.title ?? r.id} → me`, note: '', title: `What has ${r.title ?? r.id} to me`, term: { link: `${r.id} me` } }));
    return [wordsChoice(q), ...modeChoices(mode, q), ...items, ...typed, ...linked];
  }
  if (mode === 'Only') {
    const words = offered(f.only ?? []).filter((w) => has(w.word, q)).map((w) => ({ kind: 'Word', label: w.word, note: '', title: w.title, term: { only: w.word } }));
    const mine = has('owner me', q) && !(f.only ?? []).includes('owner me') ? [{ kind: 'Owner', label: 'me', note: '', title: 'What is mine', term: { only: 'owner me' } }] : [];
    const statuses = [...new Set([...types.values()].flatMap((t) => [...(t.statuses?.open ?? []), ...(t.statuses?.closed ?? [])]))].filter((s) => q && has(s, q)).slice(0, c.most)
      .map((s) => ({ kind: 'Status', label: s, note: '', title: `Only what is ${s}`, term: { only: `status ${s}` } }));
    const typed = typeList(q, c.most).map((t) => ({ kind: 'Type', label: typeChoice(t), note: '', title: `Only what is of the type ${t.title}`, term: { only: t.id } }));
    const within = (await found(q, c.most)).map((e) => ({ kind: 'Within', label: e.title, note: typeTitle(e.type), title: `Only what is within ${e.title}, at any depth`, term: { within: e.id } }));
    const people = (await found(q, c.most, 'actor')).map((e) => ({ kind: 'Owner', label: e.title, note: typeTitle(e.type), title: `Only what ${e.title} owns`, term: { only: `owner ${e.id}` } }));
    return [...modeChoices(mode, q), ...words, ...mine, ...statuses, ...typed, ...within, ...people];
  }
  if (mode === 'Not') {
    const out = f.exclude ?? ['system'];
    const kinds = ['closed', 'system'].filter((x) => !out.includes(x) && has(x, q)).map((x) => ({ kind: 'Not', label: x, note: '', title: x === 'closed' ? 'Leave out what is done or closed' : 'Leave out what the system keeps', term: { exclude: x } }));
    const typed = typeList(q, c.most).filter((t) => !out.includes(t.id)).map((t) => ({ kind: 'Type', label: typeChoice(t), note: '', title: `Leave out items of the type ${t.title}`, term: { exclude: t.id } }));
    return [...modeChoices(mode, q), ...kinds, ...typed];
  }
  if (mode === 'Walk') {
    const every = has('every link', q) && c.lens.walk?.over !== 'all' ? [{ kind: 'Walk', label: 'every link', note: '', title: 'Every link, either way', walk: 'all' }] : [];
    const ways = linkList(q, c.most).flatMap((r) => ['out', 'in', 'either'].map((way) => ({ kind: 'Walk', label: `${ARROW[way]} ${r.title ?? r.id}`, note: '', title: { out: 'Out along this link', in: 'In along this link', either: 'Either way along this link' }[way], walk: withWay(r.id, way) })));
    return [...modeChoices(mode, q), ...every, ...ways];
  }
  // Limit: a whole number, the most items drawn.
  const n = Number(q);
  return [...modeChoices(mode, q), ...(Number.isInteger(n) && n >= 1 ? [{ kind: 'Limit', label: String(n), note: '', title: `Draw at most ${n} items`, limit: n }] : [])];
}
