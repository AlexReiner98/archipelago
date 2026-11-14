// Away and summon (task e_rfjwstnu): what find's parts are told of the page around them, which a walled part cannot
// see. A press outside every part on find's slots (find, the bar's line and its rows), or another pane taking the
// focus, tells each of them `{ name: 'away' }`; `/` pressed outside a field focuses the input of the part on `find`
// and tells it `{ name: 'summon' }`. Heard once for the page, from the first mount on those slots.

import { AWAY_SLOTS } from './part-slots.js';

let heard = false;

/** Tell every part on find's slots it is away. `mounted()` lists the parts mounted now, each as { m, tell(event) }. */
export function tellAway(mounted) {
  for (const { m, tell } of mounted()) if (AWAY_SLOTS.includes(m.part.slot) && m.node.isConnected) tell({ name: 'away' });
}

/** Hear the page for the parts on find's slots, once: presses outside them, and `/` outside a field. */
export function hearAway(mounted) {
  if (heard) return;
  heard = true;
  document.addEventListener('pointerdown', (ev) => {
    const near = [...mounted()].some(({ m }) => AWAY_SLOTS.includes(m.part.slot) && m.node.contains(ev.target));
    if (!near) tellAway(mounted);
  }, true);
  addEventListener('keydown', (ev) => {
    if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const finds = [...mounted()].filter(({ m }) => m.part.slot === 'find' && m.node.isConnected);
    if (!finds.length) return;
    // The part's own: the page's find bar does not open beside it.
    ev.preventDefault();
    ev.stopImmediatePropagation();
    for (const { m, tell } of finds) (m.node.querySelector('input, textarea')?.focus(), tell({ name: 'summon' }));
  }, true);
}
