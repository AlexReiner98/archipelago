// A lens answer drawn as pages: each item a page, its note read whole as a reader meets it (./text.js), side by side
// on the canvas, so documents are read and reviewed where they stand. A line holding only an item's id brings that
// item in there, as a section under its own title, the way a document is published (src/documents.ts); an item a page
// brings in is not a page of its own as well. Every title leads to its item's page, where it is changed. It is laid
// out by the page, not drawn to a size: the frame does not pan or zoom it. Its look is ./look.js.

import { css } from './look.js';
import { m } from './marks.js';
import { blocks, render } from './text.js';

/** How deep a section may bring in sections of its own before it is only named. */
const DEPTH = 3;

/** What the page says when there is nothing to read. */
const quiet = (text) => m('div', { class: 'pg-empty' }, text);

/**
 * The pages. `input` is what the page gives every drawing: the answer (its items' notes whole, as the drawing asks,
 * `notes` in pack.json), and the style.
 */
export function picture({ answer, style }) {
  const items = answer.items.filter((i) => !i.pending || i.pending.op !== 'create');
  if (!items.length) return { scene: { message: 'Nothing to read with this lens.' } };
  const byId = new Map(items.map((i) => [i.id, i]));
  const titles = new Map(items.map((i) => [i.id, i.title]));
  const read = new Map(items.map((i) => [i.id, blocks(i.body)]));
  // An item another page brings in is read there; what nothing brings in is a page, in the lens's order.
  const brought = new Set(items.flatMap((i) => read.get(i.id).flatMap((b) => (b.section && b.section !== i.id ? [b.section] : []))));
  const tops = items.filter((i) => !brought.has(i.id));
  // A loop (two notes bringing each other in) leaves nothing on top: then every item is a page.
  const pages = tops.length ? tops : items;

  const section = (seen, depth) => (id) => {
    const item = byId.get(id);
    if (!item) return m('div', { class: 'pg-missing' }, m('a', { href: `#/e/${id}`, title: `${id}: not in this lens` }, titles.get(id) ?? id), ' is brought in here');
    if (seen.has(id) || depth > DEPTH) return m('div', { class: 'pg-missing' }, m('a', { href: `#/e/${id}` }, item.title), ' again');
    const inner = new Set(seen).add(id);
    const said = read.get(id);
    return m(
      'div',
      { class: `pg-section${item.open === false ? ' closed' : ''}` },
      m('div', { class: 'pg-h pg-h2' }, m('a', { href: `#/e/${id}`, title: [item.title, item.status].filter(Boolean).join(': ') }, item.title)),
      said.length ? render(said, titles, section(inner, depth + 1)) : quiet('Nothing written yet'),
    );
  };

  const page = (item) => {
    const said = read.get(item.id);
    const counted = said.filter((b) => b.section).length;
    const meta = [item.type, item.status, counted && `${counted} section${counted === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    return m(
      'div',
      { key: `p:${item.id}`, class: `pg-page${item.id === style.here ? ' here' : ''}` },
      m('a', { class: 'pg-title', href: `#/e/${item.id}`, title: item.title }, item.title),
      m('div', { class: 'pg-meta', title: meta }, meta),
      said.length ? render(said, titles, section(new Set([item.id]), 1)) : quiet('Nothing written yet'),
    );
  };

  return {
    scene: { css, svg: m('div', { class: 'pg-stage' }, pages.map(page)), key: [], ...(byId.has(style.here) && pages.some((p) => p.id === style.here) && { focus: `p:${style.here}` }) },
    on: () => [],
    restyle: () => [],
  };
}
