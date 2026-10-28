// Whether the reader is busy in a pane of the tab in sight (ui/panes.js), so that what an agent shows passes it by
// (ui/pane-route.js): a press, a scroll, a wheel or a key in that pane within the last while, text selected there, or,
// for the pane in focus, words typed into the sheet over it and not yet saved. Moving the pointer is watching, not working, and a
// dial, a tick or a pick is not unsaved work (ui/live.js). A tab popped out into a window (ui/tab-bar.js) keeps when it
// was last worked in, for the main page to read; and the main page keeps the windows it popped out, so an agent's next
// step can go to one.

import { state } from './base.js';

const quietAfter = 20_000;
const popped = window.name.startsWith('pelago-tab:') ? window.name.slice('pelago-tab:'.length) : null;
const keyOf = (id) => `pelago-pane-busy:${id}`;

/** The pane in focus: the sheet opens over it. */
const inFocus = () => document.querySelector('#canvas > .pane.pane-active')?.dataset.pane ?? null;
/** The pane an element is in, by its id: the sheet is the pane in focus's. */
export const paneOf = (el) => el?.closest?.('#canvas > .pane')?.dataset.pane ?? (el?.closest?.('#sheet') ? inFocus() : null);

const lastAt = new Map();
let keptAt = 0;
function stir(target) {
  const id = popped ?? paneOf(target);
  if (!id) return;
  const now = Date.now();
  lastAt.set(id, now);
  if (!popped || now - keptAt < 1000) return;
  keptAt = now;
  try {
    localStorage.setItem(keyOf(popped), String(now));
  } catch {
    // Without storage, the main page does not know this window is being read.
  }
}
for (const name of ['pointerdown', 'wheel', 'keydown', 'scroll']) addEventListener(name, (ev) => stir(ev.target), { passive: true, capture: true });
// The focus going into a drawing's frame is a press there: the frame keeps its own presses.
addEventListener('blur', () => setTimeout(() => document.activeElement?.tagName === 'IFRAME' && stir(document.activeElement), 0));

/** Whether the reader is at work in pane `id` of the tab in sight now, or in the window tab `id` was popped out into. */
export function busy(id) {
  let last = lastAt.get(id) ?? 0;
  try {
    last = Math.max(last, Number(localStorage.getItem(keyOf(id))) || 0);
  } catch {
    // Without storage, only this page's own presses count.
  }
  if (Date.now() - last < quietAfter) return true;
  const selected = getSelection();
  if (selected?.toString() && paneOf(selected.anchorNode?.parentElement) === id) return true;
  return id === inFocus() && state.dirty;
}

/** The windows this page popped out, by tab: an agent's step reaches one through it. */
export const windows = new Map();
/** A window popped out by this page that is still open, if tab `id` has one. */
export const windowOf = (id) => {
  const win = windows.get(id);
  return win && !win.closed ? win : null;
};
