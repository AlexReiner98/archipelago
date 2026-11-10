// The page's half of the one gesture a drawing opts into (decision e_qpaqnmrc, axis F; the drawing's half is
// `gestures` in ui/draw-marks.js): a mark that asks for `add`, standing for an island by its `item`, is a button the
// page answers itself, putting a new item on that island to the person (ui/layout-asks.js addOn). It is not told to
// the drawing and waits for no picture: a drawing's port runs its messages one after another, so an event sent while
// it solves waits for the whole solve (the owner, 10 Nov 2026: the gestures moved from the plane to buttons; a link is
// started from an item's page, ui/link-pick.js).

import { addOn } from './layout-asks.js';

/** Make `el` a button that adds an item on the island it stands for; what it makes stays in sight (ui/keep-in-view.js). */
export function addable(el) {
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  const go = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const island = el.dataset.item;
    if (island) await addOn(island);
  };
  el.addEventListener('click', go);
  el.addEventListener('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && go(ev));
  // Neither the plane's pan nor a click through to the island's page starts from it.
  el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
}
