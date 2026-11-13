// Pointing at a term of the query lights what it brought: the page does it, not the drawing, so every style lights
// alike. A mark says the item it stands for (packs/walls/page/marks.js); what a term found is in the lens's answer (each item's
// `terms`, and the step of the walk that reached it). What is not lit fades by the style's `dim`. The rule is one
// stylesheet, so a mark drawn while the pointer is there (what comes into sight) fades with the rest.

import { api } from './base.js';
import { lightItems } from './light-items.js';
import { litBy } from './lit-by.js';

/** Light these items in a view, the rest faded; with none, take it off: the runtime's (packs/surface/page/light-items.js). */
export { lightItems };

/** Light what `term` of Find brought in this view, or, with none, take the lighting off. */
export function lightTerm(view, lens, term) {
  lightItems(view, term && view?.answer?.items ? litBy(view.answer, term) : null);
}

const asked = new Map();
/** How many items the lens without this term would add to what it draws: said as −12, or 200+ past the limit. */
export function removedBy(lens, wider, answer) {
  const key = JSON.stringify([lens.filter, wider.filter, lens.walk]);
  if (!asked.has(key)) {
    if (asked.size > 40) asked.clear();
    asked.set(key, api('view', { name: 'flat', params: { filter: wider.filter, walk: lens.walk, ...(lens.limit && { limit: lens.limit }) } }));
  }
  return asked.get(key).then((more) => `−${Math.max(0, more.items.length - answer.items.length)}${more.cut ? '+' : ''}`, () => '');
}
