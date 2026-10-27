// The canvas: the map drawn across the whole page, behind everything else. What is drawn is a flat lens (a filter, a
// walk and a limit: decision e_sdsaxxq4), kept in the address (#/v?..., or an item's page over it, #/e/<id>?...) and
// shown and edited in the query bar (ui/query-bar.js): every change of what is drawn is a change of that lens. A click
// on an item adds it to the filter; the find bar adds text. It is drawn in the drawing its style names (the flow, by
// the canvas pack's preset, unless a nearer style says otherwise), so the canvas has no look of its own: it keeps
// which lens is up, lights the item whose page is open, and moves as the reader chose in the settings menu: fitted on
// every change, or left where they put it.

import { api, hooks, state } from './base.js';
import { wiresOn } from './canvas-wires.js';
import { canvasSwitch } from './canvases.js';
import { FOCUS, flatQuery, flatView } from './lens.js';
import { drawQuery } from './query-bar.js';
import { unfollow } from './replica.js';

const host = document.getElementById('canvas');
const sheet = document.getElementById('sheet');
/** Home: the map's top (what stands at the altitude of the workspace or a project) and what is directly in each, open. */
export const home = () => ({
  filter: { types: (state.schema?.types ?? []).filter((t) => !t.dormant && (t.altitude === 'workspace' || t.altitude === 'project')).map((t) => t.id), exclude: ['closed', 'system'] },
  walk: { over: ['part_of'], steps: 1 },
});
/** The canvas an item's address opens when no lens is asked: the item and what it holds, depends on and waits on. */
export const focusOn = (id) => ({ filter: { ids: [id] }, walk: { over: FOCUS, steps: 1 } });
/** What is up: the lens asked for, the view drawing it, the item lit in it, the style the address asks. */
let at = null;

/** The lens the canvas draws now. */
export const lensNow = () => at?.lens ?? null;
/** The address that brings the canvas as it is back, with no page open over it. */
export const canvasHref = () => (!at || at.home ? '#/' : `#/v?${flatQuery(at.lens, at.asked)}`);
/** The address of an item's page over the canvas as it is, which keeps what it draws (a click in another pane, ui/panes.js). */
export const sheetOver = (id) => `#/e/${id}${at ? `?${flatQuery(at.lens, at.asked)}` : ''}`;
/** Whether the canvas draws this item now. */
export const canvasHas = (id) => Boolean(at?.view.answer?.items.some((i) => i.id === id));
/** Draw this lens instead, through the address: under the item whose page is open, if one is. */
export function goLens(lens) {
  const open = /^#\/e\/(e_[a-z0-9]{8})/.exec(location.hash)?.[1];
  location.hash = `${open ? `#/e/${open}` : '#/v'}?${flatQuery(lens, at?.asked)}`;
}
/** The lens with this item in its filter: growing a canvas is editing its lens. */
export const withItem = (lens, id) => (lens.filter.ids?.includes(id) ? lens : { ...lens, filter: { ...lens.filter, ids: [...(lens.filter.ids ?? []), id] } });
/** The canvas as places are kept for it: the saved canvas up (ui/canvases.js), else the first item its filter names, else the whole map (''). */
const canvasOf = (lens, asked) => asked?.canvas ?? lens.filter.ids?.[0] ?? '';

/** Draw this lens on the canvas (Home when it is null), the item `here` lit, unless it is up already: then only what is lit changes. */
export function showCanvas(lens, here, asked = {}) {
  const isHome = !lens;
  lens ??= home();
  const key = JSON.stringify([lens, asked]);
  if (at?.key === key && at.view.isConnected) return mark(here);
  // Moves made on the canvas left are written before another is drawn.
  writeMoves();
  // Where things were put here is read beside the lens, into `placed`: one object the picture keeps, filled in place.
  const style = { ...asked, ...(here && { here }), snap: Boolean(settings.snap), placed: {} };
  at = { key, view: null, lens, home: isHome, here, kept: null, style, asked };
  drawAgain();
  readPlaces(canvasOf(lens, asked), style.placed);
}

/** Draw the lens up now anew, with the places it has now: a picture already drawn takes no new places in a restyle. */
function drawAgain() {
  const of = at.lens.filter.ids?.[0];
  const view = flatView({ lens: at.lens, style: at.style, of, key: `canvas:${canvasOf(at.lens, at.asked) || 'map'}` });
  const { lens, asked, home: isHome } = at;
  // The saved canvas up, named first in the bar, with the switch to the others.
  const lead = canvasSwitch(lens, asked, isHome);
  // The picture it replaces stops being kept current from the log.
  if (at.view?.store) unfollow(at.view.store);
  at.view = view;
  // The bar says the lens at once, and again with what its answer found (the names of the items it names, a cut).
  view.addEventListener('lens-answer', () => at?.view === view && drawQuery(lens, view, goLens, lead));
  drawQuery(lens, view, goLens, lead);
  host.replaceChildren(view);
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
const canvasNow = () => (at ? canvasOf(at.lens, at.asked) : null);
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

/** fit: all of it brought into sight on every change; else the reader alone moves it. The key is the style's (key). */
const settings = { fit: true, snap: false };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('pelago-canvas') ?? '{}'));
} catch {
  // Without storage, as it comes.
}
/** The frame the drawing moves in now, and what moves it (ui/pan-zoom.js). */
const moves = () => at?.view.querySelector('.lens-view')?.moves;
/** What the sheet covers on the right of the canvas; a sheet as wide as the page leaves nothing beside it. */
const covered = () => {
  if (document.body.dataset.sheet !== 'open' || sheet.offsetWidth >= innerWidth * 0.8) return 0;
  return Math.max(0, host.getBoundingClientRect().right - sheet.getBoundingClientRect().left);
};
/** What the bars cover of the canvas above and below: the query bar's foot, and the find bar's top, in the canvas's own frame (it may be one pane of several, ui/panes.js). */
const bars = () => {
  const edge = (id, side) => { const el = document.getElementById(id); return el && !el.hidden ? el.getBoundingClientRect()[side] : undefined; };
  const box = host.getBoundingClientRect();
  const foot = edge('query', 'bottom') ?? edge('nav', 'bottom') ?? box.top, find = edge('find', 'top');
  return [Math.max(0, foot - box.top), find === undefined ? 0 : Math.max(0, box.bottom - find)];
};
/** All of it in sight, beside the sheet and between the bars, when the reader asked for that. */
const fitNow = () => settings.fit && moves()?.fit(covered(), ...bars());
function apply() {
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
// A click on an item drawn adds it to the lens's filter, and opens its page over the canvas.
host.addEventListener('click', (ev) => {
  const id = /^#\/e\/(e_[a-z0-9]{8})$/.exec(ev.target.closest?.('a')?.getAttribute('href') ?? '')?.[1];
  if (!id || !at || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
  ev.preventDefault();
  location.hash = `#/e/${id}?${flatQuery(withItem(at.lens, id), at.asked)}`;
});
// A wire drawn by hand from one step to another makes a link; a held change is decided where it is drawn.
wiresOn(host, () => at?.view.store);
// A new item is started where the canvas is double-clicked, away from anything drawn on it.
host.addEventListener('dblclick', (ev) => !ev.target.closest('a, button, input, select') && (location.hash = '#/new'));
// The sheet opening or shutting, and the window resized, change the room it is fitted to.
new MutationObserver(fitNow).observe(document.body, { attributes: true, attributeFilter: ['data-sheet'] });
addEventListener('resize', fitNow);

/**
 * Read the canvas's lens again, drawn again only if its answer differs: after something made here, which the lens may
 * now reach. When the map only changed under the page (`tail`), a canvas held in a store is already kept current by
 * the facts (ui/replica.js), and is not read again.
 */
export const refreshCanvas = (tail = false) => (tail && at?.view.store ? undefined : at?.view.refresh?.());
