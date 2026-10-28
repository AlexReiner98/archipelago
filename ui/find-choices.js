// What words typed in find could be (decision e_2a4mddx8), each choice said by its kind so nothing is guessed (decision
// e_45sgrfqd): Words first, always, and lit, so Enter takes the words unless another is chosen; then, for the items the
// search read finds by name, all that is In each and the Item itself (a tag as a Tag); the types and the links whose
// names hold the words (a link to me); last, a New item of that name. Each choice says the term it adds, kept by id.

import { api } from './base.js';
import { relations, titles, typeTitle, types, workType } from './words.js';

const has = (name, q) => String(name ?? '').toLowerCase().includes(q.toLowerCase());

/** The words themselves, the first choice: drawn at once, before the search answers, so Enter never waits on it. */
export function wordsChoice(q) {
  return { kind: 'Words', label: `“${q}”`, note: '', title: `Words to find in titles and notes: “${q}”`, words: q };
}

/** The choices for `q`, in order: { kind, label, note, title, words?, term?, go? }. `most` is how many items, types and links are offered. */
export async function choicesFor(q, most) {
  const found = await api('search', { q, limit: most }).catch(() => []);
  const items = found.flatMap((e) => {
    titles.set(e.id, e.title);
    const what = typeTitle(e.type);
    if (e.type === 'tag') return [{ kind: 'Tag', label: `#${e.title}`, note: '', title: `Items tagged ${e.title}`, term: { link: `tagged ${e.id}` } }];
    return [
      { kind: 'In', label: e.title, note: what, title: `All that is in ${e.title} (${what}), at any depth`, term: { in: e.id } },
      { kind: 'Item', label: e.title, note: what, title: `${e.title} (${what}) alone`, term: { id: e.id } },
    ];
  });
  const typed = [...types.values()].filter((t) => !t.system && t.kind !== 'system' && has(t.title, q)).slice(0, most)
    .map((t) => ({ kind: 'Type', label: t.title, note: '', title: `Items of the type ${t.title}, the newest first`, term: { type: t.id } }));
  const linked = [...relations.values()].filter((r) => !r.id.startsWith('sys.') && r.id !== 'tagged' && has(r.title ?? r.id, q)).slice(0, most)
    .map((r) => ({ kind: 'Link', label: `${r.title ?? r.id} → me`, note: '', title: `What has ${r.title ?? r.id} to me`, term: { link: `${r.id} me` } }));
  return [wordsChoice(q), ...items, ...typed, ...linked,
    { kind: 'New', label: q, note: typeTitle(workType()), title: `A new item named “${q}”`, go: `#/new/${workType()}?title=${encodeURIComponent(q)}` }];
}
