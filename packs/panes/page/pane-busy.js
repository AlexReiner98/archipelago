// Whether the reader is busy in the tab in sight's canvas (packs/panes/page/panes.js), so that what an agent shows there
// waits for them (packs/panes/parts/route.js): a press, a scroll, a wheel or a key in it tells the panes part, once a
// second at most. Moving the pointer is watching, not working.

import { hooks } from './base.js';

/** The canvas the panes part draws, by its pane's id (its mark's key is `pane:<id>`); the sheet over it is its too. */
const inFocus = () => paneKey(document.querySelector('#canvas .pm-pane[aria-selected="true"]'));
const paneKey = (el) => /^pane:(.+)$/.exec(el?.dataset?.key ?? '')?.[1] ?? null;
const paneOf = (el) => paneKey(el?.closest?.('#canvas .pm-pane')) ?? (el?.closest?.('#sheet') ? inFocus() : null);

let lastAt = 0;
function stir(target) {
  const id = paneOf(target);
  const now = Date.now();
  if (!id || now - lastAt < 1000) return;
  lastAt = now;
  hooks.tellSlot?.('tabs', { name: 'busy', pane: id });
}
for (const name of ['pointerdown', 'wheel', 'keydown', 'scroll']) addEventListener(name, (ev) => stir(ev.target), { passive: true, capture: true });
// The focus going into a drawing's frame is a press there: the frame keeps its own presses.
addEventListener('blur', () => setTimeout(() => document.activeElement?.tagName === 'IFRAME' && stir(document.activeElement), 0));
