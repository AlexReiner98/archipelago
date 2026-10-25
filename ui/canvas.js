// The canvas: the map drawn across the whole page, behind everything else. Home is the map's top with what is in each
// thing; an item's address is the canvas where it stands, among what is beside it; a view's address (#/v?...) is that
// view. What is drawn is a lens, in the drawing its style names (the flow, by the canvas pack's preset, unless a nearer
// style says otherwise), so the canvas has no look of its own:
// it keeps which lens is up, lights the item whose page is open, says in the bar where on the map it stands, and moves
// as the reader chose in the settings menu: fitted on every change, or left where they put it.

import { api, h } from './base.js';
import { lensView } from './lens.js';

const host = document.getElementById('canvas');
const trail = document.getElementById('trail');
const sheet = document.getElementById('sheet');
/** Home: the map's top and what is directly in each thing, every kind but people and the app's own records, and what
 * is loose (tied to nothing yet: what a person started on the canvas, for an agent to wire up). */
export const HOME = { kinds: ['aim', 'work', 'question', 'record', 'occurrence', 'place'], far: 1, fold: ['closed', 'system'] };
/** What is up: the lens asked for, the view drawing it, the item lit in it, the address that brings it back. */
let at = null;

/** The address that brings the canvas as it is back, with no page open over it. */
export const canvasHref = () => (!at || at.home ? '#/' : `#/v?${new URLSearchParams(Object.entries(at.lens).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]))}`);
/** Whether the canvas draws this item now. */
export const canvasHas = (id) => Boolean(at?.view.answer?.items.some((i) => i.id === id));

/** Draw this lens on the canvas, the item `here` lit, unless it is up already: then only what is lit changes. */
export function showCanvas(lens, here) {
  const home = lens === HOME;
  const key = JSON.stringify(lens);
  if (at?.key === key && at.view.isConnected) return mark(here);
  const style = here ? { here } : {};
  const view = lensView({ lens, style, key: `canvas:${lens.from ?? lens.lens ?? 'map'}` });
  host.replaceChildren(view);
  at = { key, view, lens, home, here, kept: null };
  drawTrail(lens.from);
}

/** Light one item on the canvas (its page is open), or none. */
export function mark(here) {
  if (!at || at.here === here) return;
  at.here = here;
  at.view.mark?.(here);
}

// ---- What the reader chose for the canvas, in the settings menu: kept in this browser.

/** key: the drawing's key shown. fit: all of it brought into sight on every change; else the reader alone moves it. */
const settings = { key: false, fit: true };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('pelago-canvas') ?? '{}'));
} catch {
  // Without storage, as it comes.
}
/** The frame the drawing moves in now, and what moves it (ui/pan-zoom.js). */
const moves = () => at?.view.querySelector('.lens-view')?.moves;
/** What the sheet covers on the right of the canvas; a sheet as wide as the page leaves nothing beside it. */
const covered = () => (document.body.dataset.sheet === 'open' && sheet.offsetWidth < innerWidth * 0.8 ? sheet.offsetWidth : 0);
/** All of it in sight, beside the sheet, when the reader asked for that. */
const fitNow = () => settings.fit && moves()?.fit(covered());
function apply() {
  document.body.classList.toggle('canvas-key', Boolean(settings.key));
  fitNow();
}
for (const box of document.querySelectorAll('#canvas-settings input[data-setting]')) {
  box.checked = Boolean(settings[box.dataset.setting]);
  box.addEventListener('change', () => {
    settings[box.dataset.setting] = box.checked;
    try {
      localStorage.setItem('pelago-canvas', JSON.stringify(settings));
    } catch {
      // Kept until the page is reloaded.
    }
    apply();
  });
}
apply();
// Where the reader left it, each time they move it: a drawing drawn again (the map changed) is put back there.
const keep = () => at && moves() && (at.kept = moves().state());
for (const name of ['pointerup', 'wheel']) host.addEventListener(name, () => setTimeout(keep, 0), { passive: true });
// A drawing mounted anew (a new view, the map changed under it): fitted, or back where the reader left it.
new MutationObserver((list) => {
  if (!list.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches('.lf-stage') || n.querySelector?.('.lf-stage'))))) return;
  if (settings.fit) fitNow();
  else if (at?.kept) moves()?.restore(at.kept);
}).observe(host, { childList: true, subtree: true });
// A new item is started where the canvas is double-clicked, away from anything drawn on it.
host.addEventListener('dblclick', (ev) => !ev.target.closest('a, button, input, select') && (location.hash = '#/new'));
// The sheet opening or shutting, and the window resized, change the room it is fitted to.
new MutationObserver(fitNow).observe(document.body, { attributes: true, attributeFilter: ['data-sheet'] });
addEventListener('resize', fitNow);

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
