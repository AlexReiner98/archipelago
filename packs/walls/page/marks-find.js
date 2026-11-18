// The page's half of a mark that edits the canvas query (lane e_nfapxupx; verdict e_xqmtjtpw: opening a pack's parts
// is an edit of the query): a mark that asks for `find`, naming a term of Find by its `find` attribute, is a button the
// page answers itself, as the add and toggle buttons are (./marks-add.js, ./marks-toggle.js). A click adds that term to
// the query the canvas draws, or takes it away when it is there, as the page's own filter edits do: through hooks.go
// (packs/surface/page/canvas.js), which makes the lens with the same algebra a part's `go` uses. It writes nothing to the
// map, so a session that may only read may still use it; the query it leaves is one an agent reads the same (flat).

import { hooks } from './base.js';

/** A term as a mark may name it: words on one line, as the lens algebra takes them (./lens-terms.js). */
export const findTerm = (said) => {
  const t = String(said ?? '').trim().replace(/\s+/g, ' ');
  return t.length > 0 && t.length <= 300 && !/[\n\r]/.test(t) ? t : null;
};

/** Whether the query names the term in Find already, the words compared as the server says them (one space between). */
const has = (query, term) => (query?.filter?.find ?? []).some((t) => findTerm(t)?.toLowerCase() === term.toLowerCase());

/** The term exactly as the query has it, so taking it away takes that one. */
const asHad = (query, term) => (query?.filter?.find ?? []).find((t) => findTerm(t)?.toLowerCase() === term.toLowerCase());

/**
 * Add `term` to the canvas query's Find, or take it away where the query has it. The picture stays where the reader
 * is looking (`stay`), and what it adds, named by the key of its mark (`shows`), is brought into sight once drawn.
 */
export function toggleFind(term, shows) {
  const t = findTerm(term);
  if (!t) return;
  const query = hooks.address?.()?.query ?? null;
  hooks.go?.(has(query, t) ? { take: { part: 'find', value: asHad(query, t) }, stay: true } : { add: { find: t }, stay: true, ...(findTerm(shows) && { shows: findTerm(shows) }) });
}

/** Make `el` a button that adds its term to the canvas query, or takes it away. */
export function findable(el) {
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  const go = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    toggleFind(el.dataset.find, el.dataset.shows);
  };
  el.addEventListener('click', go);
  el.addEventListener('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && go(ev));
  // Neither the plane's pan nor a click through to the island's page starts from it.
  el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
}
