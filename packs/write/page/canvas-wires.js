// Changes held for the owner, decided where they land (the owner, 25 Oct 2026; 31 Oct 2026). Wires are no longer drawn
// by hand on the canvas (the owner, 28 Oct 2026: never used). A click on a held change's badge (packs/walls/page/layout.js:
// `drawing-held`) opens the sheet of the item it touches, or its own sheet when it only makes new ones, where it is
// applied or declined (packs/write/page/item-held.js).

// A mark keyed for a held change that is on an item (`held:<proposal>:<item id>`, a run asking for it) opens that item
// once the change is no longer held, so its click never goes nowhere.

import { heldAt } from './item-held.js';

const ON_ITEM = /^held:p_[a-z0-9]+:(e_[a-z0-9]{8})$/;

/** Where a click on a mark keyed `key` for held change `proposal` leads, given the changes still held: null for nowhere. */
export function heldClickTo(held, proposal, key) {
  const p = (held ?? []).find((x) => x.id === proposal);
  if (p) return heldAt(p);
  const on = ON_ITEM.exec(String(key ?? ''));
  return on ? `#/e/${on[1]}` : null;
}

/** Listen on the canvas `host` for held changes clicked; `storeNow()` is the store the canvas draws from. */
export function wiresOn(host, storeNow) {
  host.addEventListener('drawing-held', (ev) => {
    const to = heldClickTo(storeNow()?.held, ev.detail.proposal, ev.detail.key);
    if (to) location.hash = to;
  });
}
