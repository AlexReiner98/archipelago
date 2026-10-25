// The canvas: the map drawn across the whole page, behind everything else. Home is the map's top with what is in each
// thing; an item's address is the canvas where it stands, among what is beside it; a view's address (#/v?...) is that
// view. What is drawn is a lens, drawn by the drawing its style names (a pack's), so the canvas has no look of its own:
// it keeps which lens is up, lights the item whose page is open, and says in the bar where on the map it stands.

import { api, h } from './base.js';
import { lensView } from './lens.js';

const host = document.getElementById('canvas');
const trail = document.getElementById('trail');
const sheet = document.getElementById('sheet');
/** Home: the map's top and what is directly in each thing, every kind but people and the app's own records. */
export const HOME = { kinds: ['aim', 'work', 'question', 'record', 'occurrence', 'place'], far: 1 };
/** What is up: the lens asked for, the view drawing it, the item lit in it, the address that brings it back. */
let at = null;

/** The address that brings the canvas as it is back, with no page open over it. */
export const canvasHref = () => (!at || at.home ? '#/' : `#/v?${new URLSearchParams(Object.entries(at.lens).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]))}`);
/** Whether the canvas draws this item now. */
export const canvasHas = (id) => Boolean(at?.view.answer?.items.some((i) => i.id === id));

/** Draw this lens on the canvas, the item `here` lit, unless it is up already: then only what is lit changes. */
export function showCanvas(lens, here) {
  const home = lens === HOME;
  // A page that draws asks for what names what and the first line of each note: the wires and the tips.
  const asked = { ...lens, mentions: true, notes: true };
  const key = JSON.stringify(asked);
  if (at?.key === key && at.view.isConnected) return mark(here);
  const style = here ? { here } : {};
  const view = lensView({ lens: asked, style, key: `canvas:${lens.from ?? lens.lens ?? 'map'}` });
  host.replaceChildren(view);
  at = { key, view, lens, home, here };
  drawTrail(lens.from);
  bring(here);
}

/** Light one item on the canvas (its page is open), or none. */
export function mark(here) {
  if (!at || at.here === here) return;
  at.here = here;
  at.view.mark?.(here);
  bring(here);
}

/** Move the canvas so an item it draws is in sight beside the sheet, unless it is already: found by its link. */
function bring(id) {
  if (!id || !at) return;
  const view = at.view;
  let tries = 0;
  const go = () => {
    const body = view.querySelector('.lens-view');
    const el = body?.querySelector(`svg a[href="#/e/${id}"]`);
    if (!el || !body.moves) return void (++tries < 60 && at?.view === view && setTimeout(go, 100));
    // What the sheet covers on the right, once it is open; a sheet as wide as the page leaves nothing to bring it to.
    const room = document.body.dataset.sheet === 'open' ? sheet.offsetWidth : 0;
    if (room > innerWidth * 0.8) return;
    const seen = el.getBoundingClientRect();
    if (seen.left >= 0 && seen.right <= innerWidth - room && seen.top >= 0 && seen.bottom <= innerHeight) return;
    const box = el.getBBox();
    body.moves.show(box.x + box.width / 2, box.y + box.height / 2, room);
  };
  setTimeout(go, 0);
}

/** The map changed: the canvas asks again, and is drawn again only if its answer differs. */
export const refreshCanvas = () => at?.view.refresh?.();

/** Where the canvas stands, in the bar: what it is drawn from and what holds that, each a step out. */
async function drawTrail(from) {
  if (!from) return trail.replaceChildren();
  const asked = from;
  const got = await api('get', { id: from }).catch(() => null);
  if (!got || at?.lens.from !== asked) return;
  const step = (id, title) => h('a', { class: 'trail-step', href: `#/v?from=${id}`, title: `The canvas from ${title}` }, title);
  trail.replaceChildren(...(got.trail ?? []).flatMap((t) => [h('span', { class: 'trail-sep' }, '›'), step(t.id, t.title)]), h('span', { class: 'trail-sep' }, '›'), h('a', { class: 'trail-step here', href: `#/e/${from}`, title: `Open ${got.entity.title}` }, got.entity.title));
}
