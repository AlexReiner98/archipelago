// A view drawn small (task e_qcydtzdj; the owner, 4 Nov 2026, decision e_nasagnyg): in this browser, in the
// background, never on the server. A thumbnail is the view drawn as the canvas draws it (flatView, the same sandboxed
// drawing) in a frame kept off screen, one at a time and only when the page is idle and the thumbnail is in sight,
// then made a still image (thumb-still.js) and kept in this browser's IndexedDB by the view and the log position its
// answer was read at, so it is drawn again only once the answer has moved on (thumb-keep.js). A store the browser
// blocks means no thumbnail, never an error. Home's list of views shows one per row; the view switcher will too.

import { api, h } from './base.js';
import { addressOf, flatView } from './query.js';
import { numberOf } from './query-base.js';
import { layouts } from './layout.js';
import { unfollow } from './replica.js';
import { keyOf, readOn } from './thumb-keep.js';
import { smallOf, stillOf } from './thumb-still.js';

const dark = matchMedia('(prefers-color-scheme: dark)');

// ---- Kept in this browser ------------------------------------------------------------------------------------

let opened;
/** The browser's store of thumbnails, or null where it is blocked (a private window, storage turned off). */
const shelf = () =>
  (opened ??= new Promise((resolve) => {
    try {
      const asked = indexedDB.open('pelago-thumbs', 1);
      asked.onupgradeneeded = () => asked.result.createObjectStore('thumbs', { keyPath: 'key' });
      asked.onsuccess = () => resolve(asked.result);
      asked.onerror = asked.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
/** One read or write of the store; null for anything that went wrong. */
const onShelf = (mode, act) =>
  shelf().then(
    (db) =>
      db &&
      new Promise((resolve) => {
        try {
          const tx = db.transaction('thumbs', mode);
          const asked = act(tx.objectStore('thumbs'));
          tx.oncomplete = () => resolve(asked.result ?? null);
          tx.onerror = tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
const kept = (key) => onShelf('readonly', (s) => s.get(key));
const keep = (thumb) => onShelf('readwrite', (s) => s.put(thumb));

// ---- One at a time, when the page is idle --------------------------------------------------------------------

const queue = [];
let busy = false;
const idle = (then) => (window.requestIdleCallback ? requestIdleCallback(then) : setTimeout(then));
function next() {
  if (busy || !queue.length) return;
  busy = true;
  idle(async () => {
    try {
      await queue.shift()();
    } catch (err) {
      console.error(err);
    }
    busy = false;
    next();
  });
}
const later = (job) => (queue.push(job), next());

/** The house style's numbers, read once: how long a drawing is waited for. */
let house;
const style = () => (house ??= api('view', { name: 'style', params: { have: [...layouts.keys()] } }).then((look) => look.style).catch(() => ({})));

/**
 * The view drawn off screen, as it opens on the canvas but still and without its key: its image (null when it drew
 * nothing), the position its answer was read at and the items and links it held, the view's own item among them.
 * Null when it failed or took longer than the style's `thumb_wait`, so it is tried again another time.
 */
async function drawSmall({ id, lens, style: own }) {
  let wait;
  try {
    wait = numberOf(await style(), 'thumb_wait');
  } catch {
    return null;
  }
  const frame = h('div', { class: 'thumb-stage', 'aria-hidden': 'true', inert: true });
  const said = new Promise((resolve) => {
    frame.addEventListener('view-drawn', (ev) => resolve(ev.detail?.state), { once: true });
    setTimeout(() => resolve('late'), wait);
  });
  const view = flatView({ lens, style: { ...own, still: true, key: 'hidden' }, key: `thumb:${id}` });
  frame.append(view);
  document.body.append(frame);
  const state = await said;
  try {
    if (state !== 'drawn' && state !== 'empty') return null;
    const store = view.store;
    const still = state === 'drawn' ? stillOf(frame) : null;
    // Painted at the size the style keeps a still at: --thumb-still, a length of the house style.
    const width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--thumb-still'));
    const image = still && width > 0 ? await smallOf(still, width) : still;
    // What the view holds is its hold on the store (ui/replica.js): the ids of its answer, at the store's position.
    const held = typeof store?.ids === 'function' ? store.ids() : (store?.ids ?? []);
    return { pos: store?.pos ?? store?.store?.pos ?? null, ids: [...held, ...(/^e_/.test(id) ? [id] : [])], image };
  } finally {
    if (view.store) unfollow(view.store);
    view.querySelector('.lens-view')?.endDrawing?.();
    frame.remove();
  }
}

// ---- A thumbnail on the page ---------------------------------------------------------------------------------

/** Begun once a thumbnail comes into sight. */
const sight = new IntersectionObserver((seen) => {
  for (const e of seen) if (e.isIntersecting) (sight.unobserve(e.target), e.target.begin?.());
});

/**
 * A view's thumbnail (`view`: its id, and its lens and style as it opens): a box of the style's thumbnail size,
 * showing what was kept at once and, once in sight, checked against the log and drawn again when its answer moved on.
 */
export function thumbOf(view) {
  const box = h('span', { class: 'thumb', 'aria-hidden': 'true' });
  const show = (image) => box.replaceChildren(...(image ? [h('img', { src: image, alt: '', decoding: 'async' })] : []));
  const asked = addressOf(view.lens, view.style);
  const key = keyOf(view.id, dark.matches);
  const had = kept(key);
  had.then((thumb) => thumb?.asked === asked && show(thumb.image));
  box.begin = () =>
    later(async () => {
      if (!box.isConnected) return;
      const thumb = await had;
      // What the log said since it was drawn, on what it held: nothing that touches it, and it stands.
      const beat = thumb?.asked === asked && Number.isInteger(thumb.pos) ? await api('tail', { after: thumb.pos, ids: thumb.ids }).catch(() => null) : null;
      const still = readOn(thumb, asked, beat);
      if (still) return void keep(still);
      const drawn = await drawSmall(view);
      if (!drawn) return;
      show(drawn.image);
      await keep({ key, asked, ...drawn });
    });
  sight.observe(box);
  return box;
}
