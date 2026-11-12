// The way back to shipped parts (task e_f7tbyj8u; the server's half is packs/loader/kernel/way-back.ts). A refined part
// may break; the person looking must always have one press that draws the island with the parts as they ship. The host
// draws that press itself, in the top layer (a manual popover), in no slot: a part answers with marks alone, which
// have no place, layer or popover of their own, so no part can draw over it or take it away. It is raised again
// whenever another popover opens, so even the host's own menus leave it in sight.
//
// The press draws the island with the shipped parts (the part loader is told through `redraw`), unpins the island's
// version on the person's authority, and is kept for that island in this browser until pressed again, so a reload
// does not bring the broken part back. Pressed again, the island draws its own parts.

import { api, h } from './base.js';

const KEY = 'pelago.way-back';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const write = (ids) => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* kept for this page alone */ } };
/** The islands drawn shipped in this page, when the browser keeps nothing. */
const here = new Set();

/** Whether the person pressed the way back on this island: the part loader then asks for the shipped parts. */
export const shippedOn = (island) => here.has(island) || read().includes(island);

function keep(island, on) {
  const ids = new Set(read());
  if (on) ids.add(island), here.add(island);
  else ids.delete(island), here.delete(island);
  write([...ids]);
}

/** Unpin an island's version: the field island-pin.ts reads, set to nothing, as the server's wayBackOps does. */
const unpinIsland = (island) => api('change', { ops: [{ op: 'update', id: island, props: { pack_version: null } }], reason: 'The way back: the island draws its parts as they ship' });

/**
 * Draw the press for an island. `refined` is what the island draws that does not ship (refinedOn: `{ pinned?, parts }`),
 * or nothing; `redraw(shipped)` has the part loader draw the island's parts, shipped or its own. Shown while the island
 * is refined or drawn shipped. Answers `{ update(refined), stop() }`.
 */
export function wayBack({ island, refined, redraw, unpin = unpinIsland }) {
  let now = refined;
  const button = h('button', { type: 'button', class: 'way-back-press', onclick: () => press() });
  const box = h('div', { class: 'way-back', popover: 'manual', 'data-host': 'way-back' }, button);
  // Placed by the style's spaces alone, at the foot of the page's far corner.
  Object.assign(box.style, { inset: 'auto var(--space-6) var(--space-6) auto', margin: '0', padding: '0', border: 'none', background: 'none' });
  document.body.append(box);

  const raise = (ev) => {
    if (ev.target === box || ev.newState !== 'open' || !box.matches(':popover-open')) return;
    box.hidePopover();
    box.showPopover();
  };
  document.addEventListener('toggle', raise, true);

  function draw() {
    const shipped = shippedOn(island);
    button.textContent = shipped ? '↺ Own parts' : '↺ Shipped parts';
    button.title = shipped
      ? 'Draw this island with its own parts again'
      : `Draw this island with the parts as they ship${now?.pinned ? ', and unpin its version' : ''}`;
    const show = shipped || !!(now && (now.pinned || now.parts?.length));
    if (show && !box.matches(':popover-open')) box.showPopover();
    if (!show && box.matches(':popover-open')) box.hidePopover();
  }

  let busy = false;
  async function press() {
    if (busy) return;
    busy = true;
    try {
      const back = !shippedOn(island);
      keep(island, back);
      draw();
      await redraw(back);
      if (back && now?.pinned) {
        await unpin(island);
        now = { ...now, pinned: undefined };
      }
    } finally {
      busy = false;
      draw();
    }
  }

  draw();
  return {
    update(refined) { now = refined; draw(); },
    stop() { document.removeEventListener('toggle', raise, true); box.remove(); },
  };
}
