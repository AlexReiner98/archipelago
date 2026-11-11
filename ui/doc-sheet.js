// An item a public view shows, opened where the reader is: what was frozen of it, read only, in a sheet over the page,
// as the app opens an item over the canvas (one thing, one page): its title, what it is and where it stands, its
// fields and its first line. Nothing in it changes anything.

import { h } from './base.js';
import { day } from './words.js';

let sheet = null;

/** Close the sheet, if one is open, and give the reader's place back. */
function close() {
  sheet?.remove();
  sheet = null;
  document.body.removeAttribute('data-doc-sheet');
}

addEventListener('keydown', (e) => e.key === 'Escape' && sheet && close());

/**
 * Open the item `id` in the sheet: read by `read`, which answers { item } or fails, its note drawn by
 * the page's own reading of the one dialect (ui/doc.js), so it reads as the page does.
 */
export async function openItem(id, read, note) {
  close();
  sheet = h('aside', { class: 'doc-sheet', role: 'dialog', 'aria-label': 'An item of this view' }, h('p', { class: 'muted' }, 'Loading…'));
  const closer = h('button', { type: 'button', class: 'doc-sheet-close', title: 'Close', 'aria-label': 'Close', onclick: close }, '×');
  document.body.append(sheet);
  document.body.setAttribute('data-doc-sheet', 'open');
  let item;
  try {
    item = (await read(id)).item;
  } catch (err) {
    return sheet?.replaceChildren(closer, h('p', { class: 'muted' }, err.message || 'This item cannot be opened here.'));
  }
  if (!sheet) return;
  const fields = Object.entries(item.fields ?? {});
  // Only what there is: the page's h() would set an empty part down as its word (false).
  const parts = [
    closer,
    h('header', {}, h('h2', {}, item.title), h('p', { class: 'muted' }, [item.type, item.status, item.updated_at && `updated ${day(item.updated_at, 'long')}`].filter(Boolean).join(' · '))),
    fields.length > 0 && h('dl', { class: 'doc-sheet-fields' }, fields.flatMap(([k, v]) => [h('dt', {}, k.replaceAll('_', ' ')), h('dd', { title: String(v) }, Array.isArray(v) ? v.join(', ') : String(v))])),
    item.body ? h('div', { class: 'text' }, note(item.body)) : h('p', { class: 'muted' }, 'No note.'),
  ];
  sheet.replaceChildren(...parts.filter(Boolean));
  closer.focus();
}
