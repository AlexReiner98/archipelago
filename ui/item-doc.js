// An item read whole, as its reader meets it (drawn by the reading page, ui/doc.js), and the links that let someone
// read it with no login.

import { api, ask, h, may, tell } from './base.js';
import { secretBox } from './workspace-cards.js';

/** The item as a reader meets it, and the links to it that still work. */
export async function readDocument(id) {
  const doc = await api('document', { id, drawn: true }).catch(() => null);
  const links = doc ? (await api('share_list', { id }).catch(() => [])).filter((s) => !s.revoked_at) : [];
  return { doc, links };
}

/** A figure kept for an item, fetched with the page's token: an image address cannot carry it. */
export const figureOf = (s, cls = 'doc-figure') => {
  const img = h('img', { class: cls, alt: s.title });
  api('picture', { result: s.id }).then((p) => (p ? (img.src = `data:${p.content_type};base64,${p.data}`) : img.remove()), () => img.remove());
  return img;
};

/**
 * Make a link that lets someone with no login read the item: a document as it is, a view drawn live, any other item
 * as its page reads. One that is not a document is given as a document that brings it in alone (src/share-view.ts).
 */
export function shareLinkOf(e, page, isDoc = true) {
  return async () => {
    const message = isDoc ? 'Anyone with the link can read it and every item it brings in, with no login, until the link is revoked.' : 'Anyone with the link can see it, with no login, until the link is revoked: a view as it stands each time it is opened, with what the workspace may see in it.';
    if (!(await ask({ title: `Make a link to "${e.title}"?`, message, action: 'Make link' }))) return;
    try {
      const made = await api('share_create', { id: e.id });
      (page.querySelector('.note') ?? page).prepend(secretBox('Link to read this. Send it to its reader.', `${location.origin}${made.path}`));
    } catch (err) {
      tell('No link was made', err.message);
    }
  };
}

/** What the item's menu offers for reading it: print it, and where this session may write, make a link to it, stop the links. */
export function documentMenu(e, links, page, redraw, writes = may('write')) {
  const shareLink = shareLinkOf(e, page);
  const stop = async (shares, what) => {
    if (!(await ask({ title: `Stop ${what}?`, message: 'It stops working at once.', action: 'Stop sharing', danger: true }))) return;
    for (const s of shares) await api('share_revoke', { id: s.id }).catch(() => null);
    redraw();
  };
  if (!writes) return [['Print or save as PDF', () => window.open(`/read/${e.id}`, '_blank')]];
  return [
    ['Print or save as PDF', () => window.open(`/read/${e.id}`, '_blank')],
    !e.archived_at && ['Make a link to read it', shareLink],
    links.length > 0 && ['Stop the links', () => stop(links, links.length === 1 ? 'the link' : `the ${links.length} links`), 'danger'],
  ];
}
