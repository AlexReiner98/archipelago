// An item read whole, as its reader meets it, in its sheet: the read that gives it, a figure kept for it, and the
// document read in its note's place as it will publish, drawn by the publish pack's part on piece.document, whose
// pictures are the host's to draw (the picture mark: a view as publishing keeps it, or a figure).

import { api, drawSlot, h, state } from './base.js';
import { renderBody } from './body.js';
import { drawFrozen } from './doc-lens.js';

/** The read that gives an item whole, as its reader meets it: the one the schema marks so (whole). */
export const wholeRead = (schema) => schema?.reads?.find((r) => r.whole)?.name;

/** The item as a reader meets it. */
export async function readDocument(id) {
  return { doc: await api(wholeRead(state.schema), { id, drawn: true }).catch(() => null) };
}

/** A figure kept for an item, fetched with the page's token: an image address cannot carry it. */
export const figureOf = (s, cls = 'doc-figure') => {
  const img = h('img', { class: cls, alt: s.title });
  api('picture', { result: s.id }).then((p) => (p ? (img.src = `data:${p.content_type};base64,${p.data}`) : img.remove()), () => img.remove());
  return img;
};

/** A picture the reader's part names, drawn out of the document it was handed: a view as publishing keeps it, else the section's figure. */
function sectionPicture(id, el, input) {
  const d = input?.views?.reading;
  const lens = d?.lenses?.[id];
  const s = d?.parts?.find((p) => p.section?.id === id)?.section;
  if (lens) {
    const at = h('div', { class: 'doc-lens' });
    el.append(at);
    drawFrozen(at, lens, d.types, { inApp: true });
  } else if (s?.picture) el.append(figureOf(s));
}

/**
 * A document read in its note's place as it will publish: the publish pack's part fills piece.document. Where no part
 * fills it here, its text is read as a note, so the page is never empty. `redraw` draws the page again (the way back);
 * the part is told how the item's own style opens notes (page.notes), as its piece's setting.
 */
export function readingOf(e, doc, style, redraw) {
  const node = h('div', { class: 'reading body-text' });
  const plain = () => node.replaceChildren(renderBody(doc.parts.map((p) => p.text ?? p.section?.body ?? '').filter(Boolean).join('\n\n')));
  drawSlot(node, { slot: 'piece.document', item: e, piece: { notes: style?.page?.notes }, redraw, picture: sectionPicture }).then((drawn) => drawn || plain(), (err) => (plain(), console.warn(err.message)));
  return node;
}

