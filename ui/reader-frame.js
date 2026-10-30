// A document as its reader meets it, in a frame on the canvas: the `reader` mark a drawing may make (ui/marks.js), as
// the pages drawing does. Its draft is the preview, what publishing it would give now (/preview/<id>); its published
// page is what visitors read (/p/<workspace>/<id>); one that cannot be published (a private one) is read as the person
// looking sees it (/read/<id>). Each is drawn by the reader itself (ui/doc.js), so it reads and
// looks as the site does, figures and drawings included. A drawing names only the item and which of the two; the page
// makes the address, says whether the draft differs from what is published (the published read), and loads the frame
// once it comes into sight. The frame is as tall as what it holds, so the canvas scrolls, not the frame. A document
// changed is read again in a frame that takes the old one's place once it has drawn, so nothing around it moves.

import { api, authHeaders, h, state } from './base.js';
import { numberOf } from './lens-base.js';

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

/** Once a frame has loaded and what it holds has stopped growing: the reader draws after it loads. */
const settled = (frame) =>
  new Promise((done) => {
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument?.documentElement;
      if (!doc) return done();
      let quiet;
      const sight = new ResizeObserver(() => (clearTimeout(quiet), (quiet = setTimeout(end, numberOf(state.style, 'reader_settles')))));
      const end = () => (sight.disconnect(), clearTimeout(most), done());
      const most = setTimeout(end, numberOf(state.style, 'reader_settles_by'));
      sight.observe(doc);
    });
  });

/** Read an item's frames again, wherever they are drawn: after it changed somewhere the lens does not see (its home map). */
export const readAgain = (id) => document.querySelectorAll(`.rd[data-item="${id}"]`).forEach((el) => el.again?.());

/** What each canvas has up: its marks but for when each document changed, and their keys. */
const up = new WeakMap();

/**
 * A scene of readers that says what is up but for when a document changed and which is lit stays, in its place, and the
 * documents that changed are read again: true when it did. `keys` takes what the scene's marks are called. Anything
 * else is drawn anew.
 */
export function stillReading(host, scene, keys) {
  const at = new Map();
  const said = JSON.stringify(scene.svg ?? null, (name, value) => {
    if (Array.isArray(value) && value[0] === 'reader') at.set(`${value[1]?.item} ${value[1]?.as}`, value[1]?.at);
    return name === 'at' ? undefined : name === 'class' ? String(value).replace(/ here\b/, '') : value;
  });
  const was = up.get(host);
  const same = was?.said === said;
  up.set(host, { said, keys: same ? was.keys : keys });
  if (!at.size || !same || !host.querySelector('.rd')) return false;
  for (const [name, el] of was.keys) keys.set(name, el);
  for (const el of host.querySelectorAll('.rd')) {
    const now = at.get(`${el.dataset.item} ${el.dataset.as}`);
    if (now !== el.seenAt) el.again(now);
  }
  return true;
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
  const el = h('div', { class: `rd ${as}`, 'data-item': id, 'data-as': as }, said, slot);
  /** The frame in the slot, or one that takes its place once it has drawn. */
  const show = (src, title) => {
    const was = slot.querySelector('iframe:not(.rd-next)');
    if (!was) return slot.replaceChildren(fitted(h('iframe', { src, title, loading: 'lazy' })));
    slot.querySelector('.rd-next')?.remove();
    const next = fitted(h('iframe', { class: 'rd-next', src, title }));
    slot.append(next);
    settled(next).then(() => next.isConnected && (was.remove(), next.classList.remove('rd-next')));
  };
  el.seenAt = attrs.at;
  const read = async (at) => {
    const state = await stateOf(id, String(at ?? ''));
    if (as === 'own') {
      said.textContent = 'Private · as you see it';
      return show(`/read/${id}`, `Private: ${id}`);
    }
    if (as === 'published' && !state?.published) {
      said.textContent = state ? 'Not published' : 'Published: could not tell';
      return el.classList.add('none');
    }
    el.classList.remove('none');
    said.textContent = as === 'published' ? 'Published' : !state ? 'Draft' : !state.published ? 'Draft · not published yet' : state.changed ? 'Draft · differs from what is published' : 'Draft · as published';
    el.classList.toggle('changed', as === 'draft' && Boolean(state?.changed));
    const src = as === 'draft' ? `/preview/${id}` : `/p/${await workspaceId()}/${id}`;
    show(src, `${as === 'draft' ? 'Draft' : 'Published'}: ${id}`);
  };
  let reading = false;
  whenSeen(el, () => ((reading = true), read(attrs.at)));
  /** Read it again, as it stands now. One not yet in sight is read then. */
  el.again = (at = `${Date.now()}`) => {
    el.seenAt = at;
    attrs.at = at;
    if (reading) read(at);
  };
  return el;
}
