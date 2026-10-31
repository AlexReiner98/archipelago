// Changes held for the owner, decided where they land (the owner, 25 Oct 2026; 31 Oct 2026). Wires are no longer drawn
// by hand on the canvas (the owner, 28 Oct 2026: never used). A click on a held change's badge (ui/drawing.js:
// `drawing-held`) opens the sheet of the item it touches, or its own sheet when it only makes new ones, where it is
// applied or declined (ui/item-held.js).

import { heldAt } from './item-held.js';

/** Listen on the canvas `host` for held changes clicked; `storeNow()` is the store the canvas draws from. */
export function wiresOn(host, storeNow) {
  host.addEventListener('drawing-held', (ev) => {
    const p = storeNow()?.held.find((x) => x.id === ev.detail.proposal);
    if (p) location.hash = heldAt(p);
  });
}
