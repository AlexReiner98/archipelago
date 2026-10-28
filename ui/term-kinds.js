// The kinds a term of the query bar is made from (decision e_45sgrfqd): a row's + opens its kinds, and a kind its
// own choices, so nothing written is ever taken for something else. Find: words, a type, a tag, a link and its end,
// an item, what is in an item. Only: a type, within an item, its plain words (done, blocked…), a status, an owner,
// changed or made since. An item is picked by its name from those the search read finds, shown with its type, and the
// lens keeps its id. Each kind answers with the term it adds, handed to `add` (ui/query-bar.js makes it a lens).

import { api } from './base.js';
import { offered } from './only-words.js';
import { titles, typeTitle } from './words.js';

/** Items found by name, each a choice that adds `term(id)`: the title, and its type so two of a name are told apart. */
const itemSearch = (add, term, most, type) => ({
  placeholder: 'An item’s name',
  find: async (q) => (await api('search', { q, limit: most, ...(type && { type }) })).map((e) => ({
    label: e.title,
    note: typeTitle(e.type),
    title: `${e.title} (${typeTitle(e.type)}, ${e.id})`,
    pick: () => (titles.set(e.id, e.title), add(term(e.id))),
  })),
});

/**
 * Find's kinds. `c` is what the bar knows: add(term); typeGroups(pick) and linkGroups(pick), the choices of each in
 * groups by where they are used; hasTags, whether the map has tags; most, how many items a search shows.
 */
export function findKinds(c) {
  const kinds = [
    { label: 'Words', title: 'Words to find in titles and notes', next: () => ({ label: 'Words', typed: { placeholder: 'Words to find', title: 'Found in titles and notes, in any form', pick: (w) => (c.add({ text: w }), true) } }) },
    { label: 'Type', title: 'Items of a type, the newest first', next: () => ({ label: 'Type', groups: c.typeGroups((t) => c.add({ type: t.id })) }) },
    c.hasTags && { label: 'Tag', title: 'Items with a tag', next: () => ({ label: 'Tag', search: { ...itemSearch(c.add, (id) => ({ link: `tagged ${id}` }), c.most, 'tag'), placeholder: 'A tag’s name' } }) },
    { label: 'Link', title: 'Items with a link to an item, or to me', next: () => ({ label: 'Link', groups: c.linkGroups((r) => ({ next: () => linkEnd(c, r) })) }) },
    { label: 'Item', title: 'One item, by its name', next: () => ({ label: 'Item', search: itemSearch(c.add, (id) => ({ id }), c.most) }) },
    { label: 'In', title: 'All that is in an item, at any depth', next: () => ({ label: 'In', search: itemSearch(c.add, (id) => ({ in: id }), c.most) }) },
  ];
  return { label: 'Find', groups: [{ label: '', items: kinds.filter(Boolean) }] };
}

/** A link's end: me, or an item by its name. */
const linkEnd = (c, r) => ({
  label: r.title ?? r.id,
  groups: [{ label: '', items: [{ label: 'me', title: `What has ${r.title ?? r.id} to me`, pick: () => c.add({ link: `${r.id} me` }) }] }],
  search: itemSearch(c.add, (id) => ({ link: `${r.id} ${id}` }), c.most),
});

/**
 * Only's kinds. `c` as Find's, with have (the Only terms there are), statuses (in use here, then the rest of the
 * types'), and days (how far back changed and made since look, in days, from the style).
 */
export function onlyKinds(c) {
  const since = (word) => ({
    label: `${word[0].toUpperCase()}${word.slice(1)} since`,
    title: `What was ${word} since a day`,
    next: () => ({
      label: `${word} since`,
      groups: [{ label: '', items: c.days.map((d) => ({ label: `${d} day${d === 1 ? '' : 's'}`, title: `${word} in the last ${d} days`, pick: () => c.add({ only: `${word} since ${d}d` }) })) }],
      typed: {
        placeholder: 'Or a date: 2026-10-01',
        title: 'A date, as year-month-day',
        pick: (w) => /^\d{4}-\d{2}-\d{2}$/.test(w) && !Number.isNaN(Date.parse(w)) && (c.add({ only: `${word} since ${w}` }), true),
      },
    }),
  });
  const words = offered(c.have).map(({ word, title }) => ({ label: word, title, pick: () => c.add({ only: word }) }));
  return {
    label: 'Only',
    groups: [
      { label: '', items: words },
      { label: '', items: [
        { label: 'Type', title: 'Only what is of a type', next: () => ({ label: 'Type', groups: c.typeGroups((t) => c.add({ only: t.id })) }) },
        { label: 'Within', title: 'Only what is within an item, at any depth', next: () => ({ label: 'Within', search: itemSearch(c.add, (id) => ({ within: id }), c.most) }) },
        { label: 'Status', title: 'Only what has a status', next: () => ({ label: 'Status', groups: [{ label: '', items: c.statuses.map((s) => ({ label: s, title: `Only what is ${s}`, pick: () => c.add({ only: `status ${s}` }) })) }] }) },
        { label: 'Owner', title: 'Only what someone owns', next: () => ({ label: 'Owner', groups: [{ label: '', items: [{ label: 'me', title: 'What is mine', pick: () => c.add({ only: 'owner me' }) }] }], search: { ...itemSearch(c.add, (id) => ({ only: `owner ${id}` }), c.most, 'actor'), placeholder: 'A person’s name' } }) },
        since('changed'),
        since('made'),
      ] },
    ],
  };
}
