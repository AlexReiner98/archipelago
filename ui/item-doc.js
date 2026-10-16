// An item read whole, as its reader meets it: its text with the items it brings in, in their places; a lens brought
// in is its picture. And the links that let someone read it with no login.

import { api, ask, h, tell } from './base.js';
import { renderBody } from './body.js';
import { lensView } from './lens.js';
import { chip, isA, pill, unfolded } from './words.js';
import { secretBox } from './workspace-cards.js';

/** The item as a reader meets it, and the links to it that still work. */
export async function readDocument(id) {
  const doc = await api('document', { id }).catch(() => null);
  const links = doc ? (await api('share_list', { id }).catch(() => [])).filter((s) => !s.revoked_at) : [];
  return { doc, links };
}

/** A figure kept for an item, fetched with the page's token: an image address cannot carry it. */
export const figureOf = (s, cls = 'doc-figure') => {
  const img = h('img', { class: cls, alt: s.title });
  api('picture', { result: s.id }).then((p) => (p ? (img.src = `data:${p.content_type};base64,${p.data}`) : img.remove()), () => img.remove());
  return img;
};

/** The text, each part where it falls. `here` is an item to mark in the pictures it brings in. */
export function documentNote(doc, id, here) {
  const lensPart = (s) =>
    h(
      'section',
      { class: 'doc-lens' },
      h('div', { class: 'doc-lens-head' }, chip(s.type), h('a', { class: 'grow', href: `#/e/${s.id}`, title: s.title }, s.title)),
      h('div', { class: 'lens-card' }, lensView({ lens: { lens: s.id }, key: `doc:${id}:${s.id}`, bare: true, style: here ? { here } : {} })),
      s.body && renderBody(s.body),
    );
  const part = (p) =>
    p.section && isA(p.section.type, 'lens')
      ? lensPart(p.section)
      : p.section
        ? h(
            'details',
            { class: 'doc-section', open: unfolded.get(`${id}:${p.section.id}`) ?? Boolean(p.section.picture), ontoggle: (ev) => unfolded.set(`${id}:${p.section.id}`, ev.target.open) },
            h('summary', {}, chip(p.section.type), h('span', { class: 'grow', title: p.section.title }, h('a', { href: `#/e/${p.section.id}` }, p.section.title)), pill(p.section.type, p.section.status)),
            p.section.picture && figureOf(p.section),
            p.section.body ? renderBody(p.section.body) : h('div', { class: 'empty' }, 'No notes.'),
          )
        : p.missing
          ? h('div', { class: 'error' }, `${p.missing}: not found, archived or not yours to see`)
          : renderBody(p.text.replace(/^#{1,3}\s+/gm, '')); // a heading for the reader is a section title here
  return h('section', { class: 'card wide note doc' }, doc.parts.length ? doc.parts.map(part) : h('div', { class: 'empty' }, 'Nothing written yet.'));
}

/** What the item's menu offers for reading it: print it, make a link to it, stop the links. */
export function documentMenu(e, links, page, redraw) {
  const shareLink = async () => {
    if (!(await ask({ title: `Make a link to "${e.title}"?`, message: 'Anyone with the link can read it and every item it brings in, with no login, until the link is revoked.', action: 'Make link' }))) return;
    try {
      const made = await api('share_create', { id: e.id });
      page.querySelector('.note').prepend(secretBox('Link to read this document. Send it to its reader.', `${location.origin}${made.path}`));
    } catch (err) {
      tell('No link was made', err.message);
    }
  };
  const stopSharing = async () => {
    if (!(await ask({ title: `Stop the ${links.length === 1 ? 'link' : `${links.length} links`} to "${e.title}"?`, message: 'They stop working at once.', action: 'Stop sharing', danger: true }))) return;
    for (const s of links) await api('share_revoke', { id: s.id }).catch(() => null);
    redraw();
  };
  return [
    ['Print or save as PDF', () => window.open(`/read/${e.id}`, '_blank')],
    !e.archived_at && ['Make a link to read it', shareLink],
    links.length > 0 && ['Stop sharing', stopSharing, 'danger'],
  ];
}
