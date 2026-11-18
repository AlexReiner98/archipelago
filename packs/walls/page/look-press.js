// What a look that presses marks first reads of the page (packs/look_draw/kernel/look-draw.ts): where a mark stands, by
// the key its drawing gave it, and how many times the page has changed since this was loaded, to say when a press has
// settled. Only the page in look mode loads it, and it presses nothing: the look's browser clicks at the place it
// answers, as a person's pointer would, so the drawing's own handler answers through the path every click takes
// (./marks.js). Nothing here is handed to a drawing.

import { keyOf } from './marks.js';

let changed = 0;
new MutationObserver((all) => void (changed += all.length)).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

/** How many changes the page has had: a look waits until it stops counting. */
export const changes = () => changed;

/** The marks in sight under `key`: the canvas's first, the last made first, as a patch replaces one. */
const marksFor = (key) => [...document.querySelectorAll('[data-drawing] *')].filter((el) => keyOf.get(el) === key).reverse();

/** A point inside `el` where a click reaches it: its middle, else the middle of a part of it, else none. */
function pointIn(el) {
  const parts = [el, ...el.querySelectorAll('*')];
  for (const part of parts) {
    const r = part.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) return { x, y };
  }
  return null;
}

/** Where to click the mark keyed `key`, brought into sight first: { x, y } in the page's pixels, or null where none is drawn or none can be reached. */
export function placeOf(key) {
  for (const el of marksFor(String(key))) {
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const at = pointIn(el);
    if (at) return at;
  }
  return null;
}
