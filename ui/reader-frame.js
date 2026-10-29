// A document as its reader meets it, in a frame on the canvas: the `reader` mark a drawing may make (ui/marks.js), as
// the pages drawing does. Its draft is the preview, what publishing it would give now (/preview/<id>); its published
// page is what visitors read (/p/<workspace>/<id>); one that cannot be published (a private one) is read as the person
// looking sees it (/read/<id>). Each is drawn by the reader itself (ui/doc.js), so it reads and
// looks as the site does, figures and drawings included. A drawing names only the item and which of the two; the page
// makes the address, says whether the draft differs from what is published (the published read), and loads the frame
// once it comes into sight. The frame is as tall as what it holds, so the canvas scrolls, not the frame.

import { api, authHeaders, h } from './base.js';

const ID = /^e_[a-z0-9]{8}$/;
export const AS = ['draft', 'published', 'own'];

/** The workspace this page reads, for a published page's address: asked once. */
let workspace;
const workspaceId = () => (workspace ??= fetch('/whoami', { headers: authHeaders() }).then((res) => res.json()).then((me) => me.workspace.id));

/** Whether each item is published and its draft differs, asked once for each item as it stood when it last changed (`at`). */
const states = new Map();
const stateOf = (id, at) => {
  const key = `${id} ${at}`;
  // A check that fails says nothing: never "not published" for what could not be asked.
  if (!states.has(key)) states.set(key, api('published', { id }).catch(() => null));
  return states.get(key);
};

/** Load a frame when it is first half in sight. */
const whenSeen = (el, fn) => {
  const sight = new IntersectionObserver((all) => all.some((e) => e.isIntersecting) && (sight.disconnect(), fn()));
  sight.observe(el);
};

/** Keep a frame as tall as the page it holds: it is of this origin, so its height can be read. */
function fitted(frame) {
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument?.documentElement;
    if (!doc) return;
    const fit = () => (frame.style.height = `${doc.scrollHeight}px`);
    new ResizeObserver(fit).observe(doc);
    fit();
  });
  return frame;
}

/**
 * The reader mark made into the page: `item` (an id), `as` (draft or published) and `at`, when it or a section it
 * brings in last changed, so a reader drawn again after a change reads it again. Anything else stops the drawing.
 */
export function readerFrame(attrs, fail) {
  const id = String(attrs.item ?? ''), as = String(attrs.as ?? '');
  if (!ID.test(id)) fail(`a reader of "${id.slice(0, 40)}"`);
  if (!AS.includes(as)) fail(`a reader as "${as.slice(0, 40)}"`);
  const said = h('div', { class: 'rd-state' });
  const slot = h('div', { class: `rd-slot ${as}` });
  const el = h('div', { class: `rd ${as}` }, said, slot);
  whenSeen(el, async () => {
    const state = await stateOf(id, String(attrs.at ?? ''));
    if (as === 'own') {
      said.textContent = 'Private · as you see it';
      return slot.replaceChildren(fitted(h('iframe', { src: `/read/${id}`, title: `Private: ${id}`, loading: 'lazy' })));
    }
    if (as === 'published' && !state?.published) {
      said.textContent = state ? 'Not published' : 'Published: could not tell';
      return el.classList.add('none');
    }
    said.textContent = as === 'published' ? 'Published' : !state ? 'Draft' : !state.published ? 'Draft · not published yet' : state.changed ? 'Draft · differs from what is published' : 'Draft · as published';
    el.classList.toggle('changed', as === 'draft' && Boolean(state?.changed));
    const src = as === 'draft' ? `/preview/${id}` : `/p/${await workspaceId()}/${id}`;
    slot.replaceChildren(fitted(h('iframe', { src, title: `${as === 'draft' ? 'Draft' : 'Published'}: ${id}`, loading: 'lazy' })));
  });
  return el;
}
