// An item read whole, as its reader meets it (drawn by the reading page, ui/doc.js), and the links that let someone
// read it with no login, and its shares with other workspaces.

import { api, ask, h, tell } from './base.js';
import { secretBox } from './workspace-cards.js';

/** The item as a reader meets it, and the links to it that still work. */
export async function readDocument(id) {
  const doc = await api('document', { id }).catch(() => null);
  const links = doc ? (await api('share_list', { id }).catch(() => [])).filter((s) => !s.revoked_at) : [];
  return { doc, links };
}

/** A figure kept for an item, fetched with the page's token: an image address cannot carry it. One read through a share, through it. */
export const figureOf = (s, cls = 'doc-figure') => {
  const img = h('img', { class: cls, alt: s.title });
  (s.via ? api('share_figure', { via: s.via, id: s.id }) : api('picture', { result: s.id })).then((p) => (p ? (img.src = `data:${p.content_type};base64,${p.data}`) : img.remove()), () => img.remove());
  return img;
};

/** What the item's menu offers for reading it: print it, make a link to it, share it with a workspace, stop sharing. */
export function documentMenu(e, links, page, redraw, doc) {
  const shareLink = async () => {
    if (!(await ask({ title: `Make a link to "${e.title}"?`, message: 'Anyone with the link can read it and every item it brings in, with no login, until the link is revoked.', action: 'Make link' }))) return;
    try {
      const made = await api('share_create', { id: e.id });
      page.querySelector('.note').prepend(secretBox('Link to read this document. Send it to its reader.', `${location.origin}${made.path}`));
    } catch (err) {
      tell('No link was made', err.message);
    }
  };
  const shareWorkspace = async () => {
    const workspace = await ask({ title: `Share "${e.title}" with a workspace?`, message: 'Those there can read it and every item it brings in once they accept it, until you stop sharing.', input: { placeholder: 'Workspace id' }, action: 'Share' });
    if (!workspace) return;
    try {
      await api('share_workspace', { id: e.id, workspace });
      redraw();
    } catch (err) {
      tell('It was not shared', err.message);
    }
  };
  const stop = async (shares, what) => {
    if (!(await ask({ title: `Stop ${what}?`, message: 'It stops working at once.', action: 'Stop sharing', danger: true }))) return;
    for (const s of shares) await api('share_revoke', { id: s.id }).catch(() => null);
    redraw();
  };
  const plain = links.filter((s) => !s.to_workspace);
  // Read here through another workspace's share: that workspace says who else may read it.
  if (doc?.from) return [['Print or save as PDF', () => window.open(`/read/${e.id}`, '_blank')]];
  return [
    ['Print or save as PDF', () => window.open(`/read/${e.id}`, '_blank')],
    !e.archived_at && ['Make a link to read it', shareLink],
    !e.archived_at && ['Share with a workspace', shareWorkspace],
    plain.length > 0 && ['Stop the links', () => stop(plain, plain.length === 1 ? 'the link' : `the ${plain.length} links`), 'danger'],
    ...links.filter((s) => s.to_workspace).map((s) => [`Stop sharing with ${s.to_workspace}`, () => stop([s], `sharing with ${s.to_workspace}`), 'danger']),
  ];
}
