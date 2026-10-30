// A lens answer drawn as pages: each document a row, its draft alone (with the style's `published`, beside what is
// published; a private one as its reader sees it), each drawn by the reader
// itself (the page's `reader` mark, ui/reader-frame.js), so it reads and looks as the site does, figures and drawings
// included, and says whether the draft differs from what is published. A line of a note holding only an item's id
// brings that item in as a section (src/documents.ts): an item another page brings in is read there, not as a row of
// its own. Each title leads to its item's page, where it is changed; with that page open the draft is read beside it
// (`beside`: what is published gives way, and the page follows the document in sight, ui/sheet-follow.js). It is laid
// out by the page, not drawn to a size: the frame does not pan or zoom it. Its look is ./look.js.

import { css } from './look.js';
import { m } from './marks.js';

/** A line that brings an item in: its id and nothing else (src/documents.ts). */
const SECTION = /^[ \t]*(e_[a-z0-9]{8})[ \t]*$/gm;
/** The ids a note brings in. The notes come whole (`notes` in pack.json), so a section far down is found too. */
const sectionsOf = (body) => [...String(body ?? '').matchAll(SECTION)].map((hit) => hit[1]);

/** What a note points at, in the order it says it: a page of the site by its address (/quickstart, / for the front page) or an item by its id. */
const POINTS = /\]\((\/[a-z0-9-]*)\)|\b(e_[a-z0-9]{8})\b/g;
const pointsOf = (body) => [...String(body ?? '').matchAll(POINTS)].map((hit) => hit[1] ?? hit[2]);
/** By name, then by id, so two of one name keep one order. */
const byTitle = (a, b) => String(a.title).localeCompare(String(b.title)) || (a.id < b.id ? -1 : 1);

/**
 * The rows in the order a reader meets the site, the same however recently each was changed: the front page (path
 * home), the header's pages by their place in it (menu), then each page the ones before it point at, in the order
 * their notes do, then what only the footer points at, then what nothing points at, by title; the footer (path
 * footer), which every page ends with, last.
 */
export function readingOrder(rows) {
  const at = new Map();
  for (const row of rows) {
    at.set(row.id, row);
    const path = row.fields?.path;
    if (path) at.set(path === 'home' ? '/' : `/${path}`, row);
  }
  const path = (r) => r.fields?.path;
  const foot = rows.filter((r) => path(r) === 'footer');
  const order = [...rows.filter((r) => path(r) === 'home'), ...rows.filter((r) => path(r) !== 'home' && path(r) !== 'footer' && typeof r.fields?.menu === 'number').sort((a, b) => a.fields.menu - b.fields.menu)];
  const seen = new Set([...order, ...foot]);
  const follow = (from) => {
    for (const point of pointsOf(from.body)) {
      const next = at.get(point);
      if (next && !seen.has(next)) seen.add(next), order.push(next);
    }
  };
  for (let i = 0; i < order.length; i++) follow(order[i]);
  for (const f of foot) {
    const from = order.length;
    follow(f);
    for (let i = from; i < order.length; i++) follow(order[i]);
  }
  const rest = rows.filter((r) => !seen.has(r)).sort(byTitle);
  return [...order, ...rest, ...foot];
}

/** The pages. `input` is what the page gives every drawing: the answer, its items' notes whole, and the style. */
export function picture({ answer, style }) {
  const items = answer.items.filter((i) => !i.pending || i.pending.op !== 'create');
  if (!items.length) return { scene: { message: 'Nothing to read with this lens.' } };
  // An item another page brings in is read there; what nothing brings in is a row, in the order the style says
  // (order: reading unless said). A loop (two notes bringing each other in) leaves nothing on top: then each is a row.
  const brought = new Set(items.flatMap((i) => sectionsOf(i.body).filter((id) => id !== i.id)));
  const tops = items.filter((i) => !brought.has(i.id));
  const found = tops.length ? tops : items;
  const rows = style.order === 'found' ? found : style.order === 'title' ? [...found].sort(byTitle) : readingOrder(found);

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
        : m('div', { class: 'pg-pair' }, m('reader', { item: item.id, as: 'draft', at: changed(item) }), style.published === true && m('reader', { item: item.id, as: 'published', at: changed(item) })),
    );
  };

  return {
    scene: { css, svg: m('div', { class: 'pg-stage' }, rows.map(row)), key: [], beside: true, ...(rows.some((r) => r.id === style.here) && { focus: `p:${style.here}` }) },
    on: () => [],
    // The page open is lit as the sheet moves from one to another; nothing is drawn again.
    restyle: (now) => rows.map((r) => ({ key: `p:${r.id}`, toggle: { here: r.id === now.here } })),
  };
}
