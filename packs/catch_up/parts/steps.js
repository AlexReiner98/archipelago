// The steps a catch-up plays, worked out from the log (task e_p3tygg6p). The runtime hands what was missed since the
// person last looked: each entry with its facts and the rows they touched as they were before it and after (it holds the
// store and the projector). This orders them into chapters of one maker each and splits each entry island by island,
// in the order the islands first come; a step that changes nothing drawn is dropped. Pure: tested without a page.

import { changeSet, isLink, touched } from './changes.js';

/** Who made an entry, for telling chapters apart: its session, else its actor. */
const makerOf = (e) => e.by?.run ?? e.by?.actor ?? '';

/**
 * The steps of `entries` ({ pos, at, by, moved?, facts, rows: [{ id, was, now }] } each, in log order), skipping the
 * person's own (`me`, their actor). `islands`: where each item drawn lives, by id, as it stood when the person left;
 * one made since lives where its own facts say, a link where its first end does. Each step: { pos, at, by, island,
 * chapter, ids, set }, `ids` what of the entry's facts it plays, `set` its change set.
 */
export function stepsOf(entries, { islands = {}, me } = {}) {
  const chapters = [];
  for (const e of entries ?? []) {
    if (me && e.by?.actor === me) continue;
    const last = chapters.at(-1);
    if (last && makerOf(last.at(-1)) === makerOf(e)) last.push(e);
    else chapters.push([e]);
  }
  /** Where each item lives as the steps go: known, then said by the facts played. */
  const where = new Map(Object.entries(islands));
  const steps = [];
  chapters.forEach((chapter, n) => {
    for (const { pos, at, by, facts = [], rows = [], moved } of chapter) {
      const rowOf = new Map(rows.map((r) => [r.id, r]));
      const linkEnd = (id) => {
        const r = rowOf.get(id);
        return (r?.now ?? r?.was)?.from_id ?? facts.find((f) => f[1] === id && f[0] === '+' && f[2] === 'link')?.[3]?.[1];
      };
      const islandOf = (id) => {
        if (isLink(id)) {
          const end = linkEnd(id);
          return end ? islandOf(end) : '';
        }
        const own = facts.find((f) => f[1] === id && f[0] === '+' && f[2] === 'island')?.[3];
        return own ?? where.get(id) ?? '';
      };
      const at_ = new Map();
      for (const f of facts) if (!at_.has(f[1])) at_.set(f[1], islandOf(f[1]));
      for (const r of rows) if (!at_.has(r.id)) at_.set(r.id, islandOf(r.id));
      for (const island of new Set(at_.values())) {
        const ids = [...at_].filter(([, i]) => i === island).map(([id]) => id);
        const set = changeSet({ from: pos - 1, to: pos, rows: rows.filter((r) => ids.includes(r.id)).map((r) => ({ ...r, by, at, pos })) });
        for (const id of ids) if (!isLink(id)) where.set(id, island);
        if (set.items.length || set.links.length) steps.push({ pos, at, by, ...(moved && { moved }), island, chapter: n, ids, set });
      }
    }
  });
  return steps;
}

/** How many items the steps change, as the band counts them. */
export const changedCount = (steps) => new Set(steps.flatMap((s) => [...touched(s.set).keys()])).size;
