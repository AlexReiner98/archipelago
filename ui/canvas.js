// The canvas: the map drawn across the whole page, behind everything else. Home is the map's top with what is in each
// thing; an item's address is the canvas where it stands, among what is beside it; a view's address (#/v?...) is that
// view. What is drawn is a lens, in the drawing its style names (the flow, by the canvas pack's preset, unless a nearer
// style says otherwise), so the canvas has no look of its own:
// it keeps which lens is up, lights the item whose page is open, says in the bar where on the map it stands, and moves
// as the reader chose in the settings menu: fitted on every change, or left where they put it.

import { api, h, hooks } from './base.js';
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
  // Moves made on the canvas left are written before another is drawn.
  writeMoves();
  // Where things were put here is read beside the lens, into `placed`: one object the picture keeps, filled in place.
  const style = { ...(here && { here }), snap: Boolean(settings.snap), placed: {} };
  at = { key, view: null, lens, home, here, kept: null, style };
  drawAgain();
  readPlaces(lens.from ?? '', style.placed);
  drawTrail(lens.from);
}

/** Draw the lens up now anew, with the places it has now: a picture already drawn takes no new places in a restyle. */
function drawAgain() {
  at.view = lensView({ lens: at.lens, style: at.style, key: `canvas:${at.lens.from ?? at.lens.lens ?? 'map'}` });
  host.replaceChildren(at.view);
}

/** Light one item on the canvas (its page is open), or none. */
export function mark(here) {
  if (!at || at.here === here) return;
  at.here = here;
  at.view.mark?.(here);
}

// ---- What was started here and is loose: the canvas goes to each once it is tied (the owner, 25 Oct 2026).

/** The loose items this reader started, kept in this browser until each is tied to something. */
const loose = new Set();
try {
  for (const id of JSON.parse(localStorage.getItem('pelago-loose') ?? '[]')) loose.add(id);
} catch {
  // Without storage, only what is started on this page is followed.
}
const keepLoose = () => {
  try {
    localStorage.setItem('pelago-loose', JSON.stringify([...loose]));
  } catch {
    // Kept until the page is reloaded.
  }
};
/** Follow an item just started, loose: when a change ties it (its own, or an agent's once approved), it is the focus. */
export const followLoose = (id) => id && (loose.add(id), keepLoose());
// The pulse says which items changes touched (ui/live.js): one of these, now tied, becomes the canvas's focus.
hooks.touched = async (touched) => {
  const ids = touched?.ids === null ? [...loose] : (touched?.ids ?? []).filter((id) => loose.has(id));
  for (const id of ids) {
    const got = await api('get', { id }).catch(() => null);
    if (got && !got.entity.archived_at && !got.incoming.length && !got.outgoing.length) continue;
    loose.delete(id);
    keepLoose();
    // Words being written in the sheet are not left for it: the reader goes there themselves.
    if (!got || got.entity.archived_at || document.querySelector('#sheet [data-draft="unsaved"]')) continue;
    if (location.hash.split('?')[0] === `#/e/${id}`) hooks.route?.();
    else location.hash = `#/e/${id}`;
  }
};

// ---- Where things were put by hand: batched on the page and written in one call just before the next action (the
// owner, 25 Oct 2026), into the places stream (decision e_n2825x2w): by canvas (what the picture is drawn from, or the
// whole map), then by item. Read beside the lens when a canvas is drawn, and handed to its drawing as `placed`.

/** Moves made and not yet written: by canvas ('' for the whole map), each { clear, moves }: laid out again, and the middle of each item moved since. */
const batched = new Map();
let writing = null;
/** The canvas up now, as the places stream names it: what it is drawn from, '' for the whole map. */
const canvasNow = () => (at ? (at.lens.from ?? '') : null);
const asked = (canvas) => (canvas ? { canvas } : {});
/** Where things were put on this canvas, into `placed` (the picture's own), once what waits to be written is. */
async function readPlaces(canvas, placed) {
  await writeMoves();
  const got = await api('places', asked(canvas)).catch(() => null);
  if (!got || at?.style.placed !== placed) return;
  // What was moved here while they were read stays where it was put.
  Object.assign(placed, got, batched.get(canvas)?.moves);
  // Read before the lens answered, they are drawn with it; after, the picture is drawn again with them.
  if (Object.keys(placed).length && at.view.answer) drawAgain();
}
/** Write what was moved, one call for each canvas; asked for before any action (ui/base.js), and when leaving. */
async function writeMoves() {
  if (writing) return writing;
  if (!batched.size) return;
  writing = (async () => {
    const batch = [...batched];
    batched.clear();
    for (const [canvas, put] of batch) {
      try {
        await api('places_put', { ...asked(canvas), moves: put.moves, ...(put.clear && { clear: true }) });
      } catch {
        // Not written: kept for the next try, under what was moved since.
        const since = batched.get(canvas);
        batched.set(canvas, !since ? put : since.clear ? since : { clear: put.clear, moves: { ...put.moves, ...since.moves } });
      }
    }
    writing = null;
  })();
  return writing;
}
hooks.act = () => writeMoves();
// Let go on the canvas (ui/drag.js): kept on the page, and in the picture's places, so a redraw keeps it where it was put.
host.addEventListener('drawing-drop', (ev) => {
  const canvas = canvasNow();
  if (canvas === null) return;
  const put = [Math.round(ev.detail.x), Math.round(ev.detail.y)];
  const was = batched.get(canvas) ?? { clear: false, moves: {} };
  batched.set(canvas, { ...was, moves: { ...was.moves, [ev.detail.id]: put } });
  at.style.placed[ev.detail.id] = put;
});
addEventListener('visibilitychange', () => document.hidden && writeMoves());
/** Lay this canvas out again as its drawing does: what was put by hand here is forgotten, in the next batch. */
function arrange() {
  const canvas = canvasNow();
  if (canvas === null) return;
  batched.set(canvas, { clear: true, moves: {} });
  for (const id of Object.keys(at.style.placed)) delete at.style.placed[id];
  drawAgain();
  writeMoves();
}
document.getElementById('canvas-arrange')?.addEventListener('click', () => (document.getElementById('more').open = false, arrange()));

// ---- What the reader chose for the canvas, in the settings menu: kept in this browser.

/** key: the drawing's key shown. fit: all of it brought into sight on every change; else the reader alone moves it. */
const settings = { key: false, fit: true, snap: false };
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
  if (at?.style) at.style.snap = Boolean(settings.snap);
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
