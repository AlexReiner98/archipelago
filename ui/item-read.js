// A document read in its sheet as its reader meets it (ui/doc.js reads it on a page of its own): its text, and in
// their places the sections it brings in, each a fold under its title with its view drawn as publishing keeps it.
// One shared from another workspace is read the same way, from the map that shares it.

import { h } from './base.js';
import { renderBody } from './body.js';
import { drawFrozen } from './doc-lens.js';
import { figureOf } from './item-doc.js';
import { titles } from './words.js';

/** The document `d` (the document read, with drawn: true) as the sheet reads it, in the page's style `style`. */
export function readingOf(d, style) {
  const sections = d.parts.filter((p) => p.section).map((p) => p.section);
  for (const s of sections) titles.set(s.id, s.title);
  for (const [id, title] of Object.entries(d.links ?? {})) titles.set(id, title);
  // A section opens as the notes do: the style's page.notes.
  const open = ['open', 'whole'].includes(style.page?.notes);
  const part = (p) => {
    if (p.text) return renderBody(p.text, { style });
    if (!p.section) return null;
    const s = p.section;
    const lens = d.lenses?.[s.id] && h('div', { class: 'doc-lens' });
    // A view is drawn once its fold is open on the page, where its width is known.
    const drawLens = (ev) => lens && ev.target.open && !lens.firstChild && drawFrozen(lens, d.lenses[s.id], d.types, { inApp: true });
    return h(
      'details',
      { class: 'section read-section', open, 'data-read': s.id, ontoggle: drawLens },
      h('summary', { title: s.title }, s.title),
      lens || (s.picture && figureOf(s)),
      s.body && renderBody(s.body, { style }),
    );
  };
  const page = h('div', { class: 'reading body-text' }, d.parts.map(part));
  // A section it names is the fold below, opened; one read through a share has no page here to lead to.
  page.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('a.note-item');
    const id = a?.getAttribute('href')?.slice(3);
    const at = id && page.querySelector(`[data-read="${id}"]`);
    if (!at && !d.from) return;
    ev.preventDefault();
    if (at) (at.open = true), at.scrollIntoView({ block: 'nearest' });
  });
  return page;
}
