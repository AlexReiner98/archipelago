// What a page drawn from frozen marks has that no part may do (decision e_rhz4dvpk, ./frozen-page.js): the read-only
// sheet of an item a picture shows, drawn from the marks the page keeps of it; where a person with no account begins;
// and the words of a page whose marks were not made, as plain marks. Every text is set as text.

import { h } from './base.js';
import { checkMarks } from './part-check.js';
import { mountPart } from './part-render.js';

/**
 * How a page read with no session reads its notes: whole, as a document is (page.notes), every title a heading. Read
 * whole, a note asks its style only how long a title may be; the look a page keeps does not hold the style's numbers
 * yet, so it reads titles as the dialect does when it is told none (packs/walls/page/text.js, readText).
 */
export const readingStyle = { page: { notes: 'whole' }, numbers: { note_title_most: 90 } };

/** Where a person with no account begins on this server (/connect/start), else its front page. */
export const startAddress = () => fetch('/connect/start').then((res) => (res.ok ? res.json() : null)).then((r) => r?.url ?? '/', () => '/');

/** The words of a page whose marks were not kept (published before pages kept them, or its part failed), as plain marks. */
export function plainMarks(d) {
  if (!Array.isArray(d?.parts)) return ['text', { look: 'muted' }, 'This page does not open anything.'];
  const part = (p, i) =>
    p.section
      ? ['box', { key: `s:${p.section.id}`, item: p.section.id, flow: 'column', gap: 3 }, ['text', { look: 'title', size: 6 }, String(p.section.title ?? '')], ...(d.lenses?.[p.section.id] || p.section.picture ? [['picture', { item: p.section.id }]] : []), ...(p.section.body ? [['note', {}, String(p.section.body)]] : [])]
      : ['note', { key: `text:${i}` }, String(p.text ?? '')];
  return ['box', { key: 'page', flow: 'column', gap: 8 }, ['text', { look: 'title', size: 8 }, String(d.title ?? '')], ...d.parts.filter((p) => !p.section || p.section.id !== d.share).map(part)];
}

let sheet = null;
/** Close the item's sheet, if one is open. */
export function closeSheet() {
  sheet?.stop();
  sheet?.node.remove();
  sheet = null;
  document.body.removeAttribute('data-doc-sheet');
}
addEventListener('keydown', (e) => e.key === 'Escape' && sheet && closeSheet());

/** Open the sheet of an item a picture shows, from the marks the page keeps of it. */
export function openSheet(marks) {
  closeSheet();
  const node = h('aside', { class: 'doc-sheet', role: 'dialog', 'aria-label': 'An item of this view' });
  document.body.append(node);
  document.body.setAttribute('data-doc-sheet', 'open');
  const render = mountPart(node, { style: readingStyle, tell: (ev) => ev?.key === 'close' && closeSheet() });
  render.draw(checkMarks(marks));
  sheet = { node, stop: () => render.stop() };
  node.querySelector('button')?.focus();
}
