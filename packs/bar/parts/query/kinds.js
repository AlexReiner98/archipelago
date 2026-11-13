// The kinds a term of the query is made from (decision e_45sgrfqd; was ui/term-kinds.js): a row's + offers its kinds,
// and a kind its own choices, so nothing written is ever taken for something else. Find, Only and Not take the same
// terms: words, a type, a link and its end, what is related to an item, an owner, an item, what is in an item, what is
// on an island. Only and Not take besides what can only be checked of what is found: the plain words (done,
// blocked…), a status, changed or made since or before. An item is picked by its name (the host finds it as the
// person types), and the lens keeps its id.
//
// A step is { label, choices, typed?, search? }: `choices` [{ id, label, tip, term } or { id, label, tip, next: () =>
// step }]; `typed` { hint, tip, term(written) } answering the term or null when it is not what the kind takes;
// `search` { hint, types?, term(id) } an item found by name. Plain data and functions: the part draws it.

import { offered } from './only-words.js';

/** An item found by name, adding `term(id)`. */
const itemSearch = (term, hint = 'An item’s name', types) => ({ hint, term, ...(types && { types }) });

/**
 * The kinds every part takes. `c` is what the bar knows: types and links, ranked (each { id, title }), the first
 * those used here.
 */
const shared = (c) => [
  { id: 'words', label: 'Words', tip: 'Words in titles and notes', next: () => ({ label: 'Words', choices: [], typed: { hint: 'Words', tip: 'In titles and notes, in any form', term: (w) => (w ? `text ${w}` : null) } }) },
  { id: 'type', label: 'Type', tip: 'Items of a type', next: () => ({ label: 'Type', choices: c.types.map((t) => ({ id: t.id, label: t.title, tip: t.title, term: `type ${t.id}` })) }) },
  { id: 'link', label: 'Link', tip: 'Items with a link to an item, or to me', next: () => ({ label: 'Link', choices: c.links.map((r) => ({ id: r.id, label: r.title, tip: r.title, next: () => linkEnd(r) })) }) },
  { id: 'related', label: 'Related', tip: 'Items with any link to an item, either way', next: () => ({ label: 'Related', choices: [], search: itemSearch((id) => `related ${id}`) }) },
  { id: 'owner', label: 'Owner', tip: 'What someone owns', next: () => ({ label: 'Owner', choices: [{ id: 'me', label: 'me', tip: 'What is mine', term: 'owner me' }], search: itemSearch((id) => `owner ${id}`, 'A person’s name', ['actor']) }) },
  { id: 'item', label: 'Item', tip: 'One item, by its name', next: () => ({ label: 'Item', choices: [], search: itemSearch((id) => `id ${id}`) }) },
  { id: 'in', label: 'In', tip: 'All that is in an item, at any depth', next: () => ({ label: 'In', choices: [], search: itemSearch((id) => `in ${id}`) }) },
  { id: 'island', label: 'Island', tip: 'All that lives on an island', next: () => ({ label: 'Island', choices: [], search: itemSearch((id) => `island ${id}`, 'An island’s name', ['island']) }) },
];

/** A link's end: me, or an item by its name. */
const linkEnd = (r) => ({
  label: r.title,
  choices: [{ id: 'me', label: 'me', tip: `What has ${r.title} to me`, term: `${r.id} me` }],
  search: itemSearch((id) => `${r.id} ${id}`),
});

/** Find's kinds. */
export const findKinds = (c) => ({ label: 'Find', choices: shared(c) });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Only's and Not's kinds. `c` as Find's, with label, its part's word; have (the terms there are), statuses (in use
 * here, then the rest of the types'), and days (how far back changed and made since look, in days, from the style).
 */
export function onlyKinds(c) {
  // Since and before: a since and a before together are a range of days.
  const since = (word, way = 'since') => ({
    id: `${word}-${way}`,
    label: `${word[0].toUpperCase()}${word.slice(1)} ${way}`,
    tip: way === 'since' ? `What was ${word} since a day` : `What was ${word} before a day began`,
    next: () => ({
      label: `${word} ${way}`,
      choices: c.days.map((d) => ({ id: `${d}d`, label: `${d} day${d === 1 ? '' : 's'}`, tip: way === 'since' ? `${word} in the last ${d} days` : `${word} over ${d} days ago`, term: `${word} ${way} ${d}d` })),
      typed: { hint: 'Or a date: 2026-10-01', tip: 'A date, as year-month-day', term: (w) => (DATE.test(w) && !Number.isNaN(Date.parse(w)) ? `${word} ${way} ${w}` : null) },
    }),
  });
  const words = offered(c.have).map(({ word, title }) => ({ id: `w:${word}`, label: word, tip: title, term: word }));
  const system = c.have.includes('kind system') ? [] : [{ id: 'system', label: 'system', tip: 'What the system keeps', term: 'kind system' }];
  return {
    label: c.label ?? 'Only',
    choices: [
      ...words,
      ...system,
      ...shared(c),
      { id: 'status', label: 'Status', tip: 'What has a status', next: () => ({ label: 'Status', choices: c.statuses.map((s) => ({ id: s, label: s, tip: `What is ${s}`, term: `status ${s}` })) }) },
      since('changed'),
      since('made'),
      since('changed', 'before'),
      since('made', 'before'),
    ],
  };
}
