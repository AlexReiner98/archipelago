// An item read whole, as its reader meets it (drawn by the reading page, ui/doc.js), and its public view: the item
// made public by a person, frozen as they saw it, at an address anyone may open (src/public-view.ts).

import { api, ask, h, may, tell } from './base.js';

/** The item as a reader meets it. */
export async function readDocument(id) {
  return { doc: await api('document', { id, drawn: true }).catch(() => null) };
}

/** The item's public view, when it has one: its address, who shared it and when. */
export const publicOf = async (id) => (await api('share_list', { id }).catch(() => []))[0] ?? null;

/** A figure kept for an item, fetched with the page's token: an image address cannot carry it. */
export const figureOf = (s, cls = 'doc-figure') => {
  const img = h('img', { class: cls, alt: s.title });
  api('picture', { result: s.id }).then((p) => (p ? (img.src = `data:${p.content_type};base64,${p.data}`) : img.remove()), () => img.remove());
  return img;
};

const names = (list) => `${list.slice(0, 3).map((i) => i.title).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`;

/**
 * Share an item: its public view, frozen now. What goes out with it and what stays out as private are said first, so
 * nothing leaves without the person seeing it. The address is copied once it is public.
 */
export async function sharePublicly(id, title) {
  let plan;
  try {
    plan = await api('share_plan', { id });
  } catch (err) {
    return void tell('Not shared', err.message);
  }
  const goes = plan.goes.filter((i) => i.id !== id);
  const message = [
    goes.length ? `Goes out with it: ${names(goes)}.` : 'It goes out alone.',
    plan.private.length && `Left out as private: ${names(plan.private)}.`,
    'Anyone may open it and search engines list it, as it is now.',
  ].filter(Boolean).join('\n');
  const again = plan.shared;
  if (!(await ask({ title: `${again ? 'Share again' : 'Share'} “${title}”?`, message, action: again ? 'Share again' : 'Share' }))) return null;
  try {
    const made = await api('share_create', { id });
    const url = `${location.origin}${made.address}`;
    const copied = await navigator.clipboard?.writeText(url).then(() => true, () => false);
    tell(copied ? 'Shared, address copied' : 'Shared', url);
    return made;
  } catch (err) {
    tell('Not shared', err.message);
    return null;
  }
}

/** What the item's menu offers for its public view: share it (again), open it, stop sharing it. */
export function shareMenu(e, shared, redraw, writes = may('write')) {
  const stop = async () => {
    if (!(await ask({ title: `Stop sharing “${e.title}”?`, message: 'Its public address stops answering at once.', action: 'Stop sharing', danger: true }))) return;
    await api('share_revoke', { id: e.id }).catch((err) => tell('Still shared', err.message));
    redraw();
  };
  return [
    writes && !e.archived_at && [shared ? 'Share again' : 'Share', async () => (await sharePublicly(e.id, e.title)) && redraw()],
    shared && ['Open its public view', () => window.open(shared.address, '_blank', 'noopener')],
    writes && shared && ['Stop sharing', stop, 'danger'],
  ];
}

/** What a document's menu offers: print it, and its public view. */
export function documentMenu(e, shared, redraw, writes = may('write')) {
  return [['Print or save as PDF', () => window.open(`/read/${e.id}`, '_blank')], ...shareMenu(e, shared, redraw, writes)];
}
