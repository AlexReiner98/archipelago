// A lens answer drawn as pages: each document a row, its draft beside what is published (a private one as its reader
// sees it, alone), each drawn by the reader
// itself (the page's `reader` mark, ui/reader-frame.js), so it reads and looks as the site does, figures and drawings
// included, and says whether the draft differs from what is published. A line of a note holding only an item's id
// brings that item in as a section (src/documents.ts): an item another page brings in is read there, not as a row of
// its own. Each title leads to its item's page, where it is changed. It is laid out by the page, not drawn to a size:
// the frame does not pan or zoom it. Its look is ./look.js.

import { css } from './look.js';
import { m } from './marks.js';

/** A line that brings an item in: its id and nothing else (src/documents.ts). */
const SECTION = /^[ \t]*(e_[a-z0-9]{8})[ \t]*$/gm;
/** The ids a note brings in. The notes come whole (`notes` in pack.json), so a section far down is found too. */
const sectionsOf = (body) => [...String(body ?? '').matchAll(SECTION)].map((hit) => hit[1]);

/** The pages. `input` is what the page gives every drawing: the answer, its items' notes whole, and the style. */
export function picture({ answer, style }) {
  const items = answer.items.filter((i) => !i.pending || i.pending.op !== 'create');
  if (!items.length) return { scene: { message: 'Nothing to read with this lens.' } };
  // An item another page brings in is read there; what nothing brings in is a row, in the lens's order. A loop (two
  // notes bringing each other in) leaves nothing on top: then each is a row.
  const brought = new Set(items.flatMap((i) => sectionsOf(i.body).filter((id) => id !== i.id)));
  const tops = items.filter((i) => !brought.has(i.id));
  const rows = tops.length ? tops : items;

  const byId = new Map(items.map((i) => [i.id, i]));
  // When it or a section it brings in last changed: a reader reads it again when that moves.
  const changed = (item) => [item, ...sectionsOf(item.body).map((id) => byId.get(id))].filter(Boolean).map((i) => String(i.updated_at ?? '')).sort().at(-1);

  const row = (item) => {
    const sections = sectionsOf(item.body).length;
    const meta = [item.type, item.status, sections && `${sections} section${sections === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    return m(
      'div',
      { key: `p:${item.id}`, class: `pg-row${item.id === style.here ? ' here' : ''}` },
      m('div', { class: 'pg-head' }, m('a', { class: 'pg-title', href: `#/e/${item.id}`, title: item.title }, item.title), m('span', { class: 'pg-meta', title: meta }, meta)),
      // A private one cannot be published, so it has no preview: it is read as its reader sees it, on its own.
      item.visibility === 'private'
        ? m('div', { class: 'pg-pair' }, m('reader', { item: item.id, as: 'own', at: changed(item) }))
        : m('div', { class: 'pg-pair' }, m('reader', { item: item.id, as: 'draft', at: changed(item) }), m('reader', { item: item.id, as: 'published', at: changed(item) })),
    );
  };

  return {
    scene: { css, svg: m('div', { class: 'pg-stage' }, rows.map(row)), key: [], ...(rows.some((r) => r.id === style.here) && { focus: `p:${style.here}` }) },
    on: () => [],
    restyle: () => [],
  };
}
