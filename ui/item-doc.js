// An item read whole, as its reader meets it (drawn by the reading page, ui/doc.js), and its public view: the item
// made public by a person, frozen as they saw it, at an address anyone may open (packs/publish/kernel/public-view.ts).

import { api, ask, h, may, state, tell } from './base.js';
import { renderBody } from './body.js';
import { drawFrozen } from './doc-lens.js';
import { drawPart } from './part-host.js';
import { menu, when } from './words.js';

/** The read that gives an item whole, as its reader meets it: the one the schema marks so (whole). */
export const wholeRead = (schema) => schema?.reads?.find((r) => r.whole)?.name;

/** The item as a reader meets it. */
export async function readDocument(id) {
  return { doc: await api(wholeRead(state.schema), { id, drawn: true }).catch(() => null) };
}

/** The item's public view, when it has one: its address, who shared it and when. */
export const publicOf = async (id) => (await api('share_list', { id }).catch(() => []))[0] ?? null;

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
  drawPart(node, { slot: 'piece.document', item: e, piece: { notes: style?.page?.notes }, redraw, picture: sectionPicture }).then((drawn) => drawn || plain(), (err) => (plain(), console.warn(err.message)));
  return node;
}

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

/**
 * The mark of an item a public view shows (task e_r9e87vgz): which views, in its tooltip. One frozen before the item
 * last changed is behind, and the mark offers to share it again, the person's act through the same share as ever.
 */
export function publicMark(views, redraw, writes = may('write')) {
  if (!views?.length) return null;
  const behind = views.filter((v) => v.behind);
  // A line for each view: its title, when it was shared, and whether this has changed since.
  const tip = ['Public in', ...views.map((v) => `${v.title}, shared ${when(v.shared_at)}${v.behind ? ': changed since' : ''}`)].join('\n');
  if (!behind.length || !writes) return h('span', { class: 'public-mark', title: tip }, behind.length ? '◉ Public, behind' : '◉ Public');
  const again = async (v) => (await sharePublicly(v.id, v.title)) && redraw();
  if (behind.length === 1) return h('button', { class: 'quiet-button public-mark behind', title: `${tip}\nShare it again with this version`, onclick: () => again(behind[0]) }, '◉ Share again');
  const box = menu('◉ Share again', behind.map((v) => [v.title, () => again(v)]));
  box.title = tip;
  box.classList.add('public-mark', 'behind');
  return box;
}
