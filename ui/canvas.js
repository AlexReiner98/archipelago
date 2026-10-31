// A canvas: the map drawn in a pane (ui/panes.js), every pane alike. What is drawn is a flat lens (a filter, a walk and
// a limit: decision e_sdsaxxq4), kept as the pane's address (v?..., ui/tabs.js) and shown and edited in the query bar
// (ui/query-bar.js) while its pane is in focus: every change of what is drawn is a change of that lens. A click on an
// item opens its page and leaves the lens as it was (decision e_jedng69e); the find bar sets its words. It is drawn in the drawing its style names (the
// flow, by the canvas pack's preset, unless a nearer style says otherwise), so a canvas has no look of its own: it keeps
// which lens is up, lights the item whose page is open, and moves as the reader chose in the settings menu: fitted on
// every change until they move it themselves (a page opened or shut then leaves it be), or left where they put it.

import { api, hooks, idsOf, state } from './base.js';
import { wiresOn } from './canvas-wires.js';
import { canvasSwitch } from './canvases.js';
import { numberOf } from './lens-base.js';
import { FOCUS, flatView } from './lens.js';
import { drawQuery } from './query-bar.js';
import { unfollow } from './replica.js';

const sheet = document.getElementById('sheet');
/**
 * Home: open projects (what stands at a project's altitude) and whatever waits on the viewer, with no walk and a short
 * limit, so the first canvas answers one question (decision e_5stjvfvb). Growing it is a step taken from an item.
 */
export const home = () => ({
  filter: { find: ['waits_on me', ...(state.schema?.types ?? []).filter((t) => !t.dormant && t.altitude === 'project').map((t) => `type ${t.id}`)], not: ['done', 'kind system'] },
  limit: numberOf(state.style, 'home_limit'),
});
/** The canvas an item's address opens when no lens is asked: the item and what it holds, depends on and waits on. */
export const focusOn = (id) => ({ filter: { find: [`id ${id}`] }, walk: { over: FOCUS, steps: 1 } });
/** The canvas as places are kept for it: the saved canvas up (ui/canvases.js), else the first item its filter names, else the whole map (''). */
/** The item a lens is drawn from: the first it names by id, else what `in` an item it draws. */
const drawnFrom = (filter) => idsOf(filter)[0] ?? (filter?.find ?? []).map((t) => /^in (e_[a-z0-9]{8})$/.exec(t)?.[1]).find(Boolean);
/**
 * What a picture's places are kept under: its canvas, and the form it is laid out in. A place means something only in the
 * picture it was put on, so the flow's are kept apart from the older layout's, whose places stay in the stream unread:
 * `flow` here names no pack, only that the form asked for is the canvas's own.
 */
const canvasOf = (lens, asked) => `${asked?.canvas ?? drawnFrom(lens.filter) ?? ''}@${asked?.shape && asked.shape !== 'flow' ? asked.shape : 'solved'}`;

/** Every canvas drawn now, and the one the bar and find act on: the pane in focus (decision e_h2pqjy2q). */
const all = new Set();
let current = null;
/** Make this canvas the one the bar acts on. */
export function activate(c) {
  current = c;
  barNow();
}
function barNow() {
  const c = current;
  if (c?.view) drawQuery(c.lens, c.view, c.pane.go, canvasSwitch(c.lens, c.asked, c.home, c.pane.open));
}
/** The lens the canvas in focus draws now. */
export const lensNow = () => current?.lens ?? null;
/** Draw this lens in the canvas in focus. */
export const goLens = (lens) => current?.pane.go(lens);
/** Open an address in the canvas in focus: a saved canvas, or a lens in a style, as the bar's switches do. */
export const openHere = (href) => current?.pane.open(href);
/** The style the canvas in focus was asked for (a shape, a style kept by id, the saved canvas up). */
export const styleNow = () => current?.asked ?? {};
/** Draw Home in the canvas in focus. */
export const goHome = () => current?.pane.go(null);
/** Whether the canvas in focus draws this item now. */
export const canvasHas = (id) => Boolean(current?.has(id));
/** Light this item in the canvas in focus (its page is open), or none. */
export const mark = (here) => current?.mark(here);
/**
 * Read every canvas's lens again, each drawn again only if its answer differs: after something made here, which a lens
 * may now reach. When the map only changed under the page (`tail`), a canvas held in a store is already kept current by
 * the facts (ui/replica.js), and is not read again.
 */
export const refreshCanvas = (tail = false) => all.forEach((c) => c.refresh(tail));

/**
 * A canvas drawn in `host`, for a pane: `pane.go(lens)` draws another lens there (null for Home), `pane.open(href)`
 * another saved canvas, `pane.opened(id, lens)` opens an item's page from a click on it, over that lens.
 */
export function canvasIn(host, pane) {
  /** What is up: the lens asked for, the view drawing it, the item lit in it, the style as asked, where it was left. */
  let at = null;
  const c = {
    pane,
    host,
    get lens() {
      return at?.lens ?? null;
    },
    get asked() {
      return at?.asked ?? {};
    },
    get home() {
      return Boolean(at?.home);
    },
    get view() {
      return at?.view ?? null;
    },
    get style() {
      return at?.style ?? null;
    },
    /** The canvas as the places stream names it: what it is drawn from, '' for the whole map; null with nothing up. */
    get places() {
      return at ? canvasOf(at.lens, at.asked) : null;
    },
    /** Draw this lens (Home when it is null), the item `here` lit, unless it is up already: then only what is lit changes. */
    show(lens, here, asked = {}) {
      const isHome = !lens;
      lens ??= home();
      const key = JSON.stringify([lens, asked]);
      if (at?.key === key && at.view.isConnected) return c.mark(here);
      // Moves made on the canvas left are written before another is drawn.
      writeMoves();
      // Where things were put here is read beside the lens, into `placed`: one object the picture keeps, filled in place.
      const style = { ...asked, ...(here && { here }), snap: Boolean(settings.snap), placed: {} };
      // The same lens drawn again (an item's page opened over it says it anew) stays where it stands: opening an item
      // does not move the canvas.
      const same = at && JSON.stringify(at.lens) === JSON.stringify(lens);
      at = { key, view: null, lens, home: isHome, here, kept: same ? (c.moves()?.state() ?? at.kept) : null, style, asked };
      c.draw();
      readPlaces(c, canvasOf(lens, asked), style.placed);
    },
    /** Draw the lens up now anew, with the places it has now: a picture already drawn takes no new places in a restyle. */
    draw() {
      const of = idsOf(at.lens.filter)[0];
      const view = flatView({ lens: at.lens, style: at.style, of, key: `canvas:${canvasOf(at.lens, at.asked) || 'map'}` });
      // The picture it replaces stops being kept current from the log.
      if (at.view?.store) unfollow(at.view.store);
      at.view = view;
      // The bar says the lens at once, and again with what its answer found (the names of the items it names, a cut).
      view.addEventListener('lens-answer', () => at?.view === view && current === c && barNow());
      if (current === c) barNow();
      host.replaceChildren(view);
    },
    mark(here) {
      if (!at || at.here === here) return;
      at.here = here;
      at.view.mark?.(here);
    },
    has: (id) => Boolean(at?.view?.answer?.items.some((i) => i.id === id)),
    refresh: (tail = false) => (tail && at?.view?.store ? undefined : at?.view?.refresh?.()),
    /** Lay this canvas out again as its drawing does: what was put by hand here is forgotten, in the next batch. */
    arrange() {
      if (!at) return;
      batched.set(c.places, { clear: true, moves: {} });
      for (const id of Object.keys(at.style.placed)) delete at.style.placed[id];
      c.draw();
      writeMoves();
    },
    /** The frame the drawing moves in now, and what moves it (ui/pan-zoom.js). */
    moves: () => at?.view?.querySelector('.lens-view')?.moves,
    /**
     * All of it in sight, beside the sheet and between the bars, when the reader asked for that and has not moved it
     * since its lens was drawn: a page opened or shut, or the window resized, does not undo their move. `force` (the
     * setting turned on) fits it whatever they did.
     */
    fit(force = false) {
      if (!settings.fit || (!force && at?.kept)) return;
      if (at) at.kept = null;
      c.moves()?.fit(covered(host), ...bars(host));
    },
    snap() {
      if (at?.style) at.style.snap = Boolean(settings.snap);
    },
    /** Stop: its picture is no longer kept current from the log. */
    close() {
      if (at?.view?.store) unfollow(at.view.store);
      all.delete(c);
      if (current === c) current = null;
    },
  };
  all.add(c);
  // Where the reader left it, each time they move it: a drawing drawn again (the map changed) is put back there.
  const keepIt = () => at && c.moves() && (at.kept = c.moves().state());
  for (const name of ['pointerup', 'wheel']) host.addEventListener(name, () => setTimeout(keepIt, 0), { passive: true });
  // A drawing mounted anew (a new view, the map changed under it): back where the reader left it, else fitted.
  new MutationObserver((list) => {
    if (!list.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches('.lf-stage') || n.querySelector?.('.lf-stage'))))) return;
    if (at?.kept) c.moves()?.restore(at.kept);
    else c.fit();
  }).observe(host, { childList: true, subtree: true });
  // A click on an item drawn opens its page over the canvas, the lens as it was: reading an item does not reshape what
  // is drawn (the owner, 28 Oct 2026, e_jedng69e).
  host.addEventListener('click', (ev) => {
    const id = /^#\/e\/(e_[a-z0-9]{8})$/.exec(ev.target.closest?.('a')?.getAttribute('href') ?? '')?.[1];
    if (!id || !at || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
    ev.preventDefault();
    pane.opened(id, at.lens);
  });
  // Let go on the canvas (ui/drag.js): kept on the page, and in the picture's places, so a redraw keeps it where it was put.
  host.addEventListener('drawing-drop', (ev) => {
    if (!at) return;
    const put = [Math.round(ev.detail.x), Math.round(ev.detail.y)];
    const was = batched.get(c.places) ?? { clear: false, moves: {} };
    batched.set(c.places, { ...was, moves: { ...was.moves, [ev.detail.id]: put } });
    at.style.placed[ev.detail.id] = put;
  });
  // A held change is decided where it is drawn.
  wiresOn(host, () => at?.view?.store);
  return c;
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
// The pulse says which items changes touched (ui/live.js): one of these, now tied, becomes the focus of the pane in focus.
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
const asked = (canvas) => (canvas ? { canvas } : {});
/** Where things were put on this canvas, into `placed` (the picture's own), once what waits to be written is. */
async function readPlaces(c, canvas, placed) {
  await writeMoves();
  const got = await api('places', asked(canvas)).catch(() => null);
  if (!got || c.style?.placed !== placed) return;
  // What was moved here while they were read stays where it was put.
  Object.assign(placed, got, batched.get(canvas)?.moves);
  // Read before the lens answered, they are drawn with it; after, the picture is drawn again with them.
  if (Object.keys(placed).length && c.view.answer) c.draw();
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
addEventListener('visibilitychange', () => document.hidden && writeMoves());

// ---- What the reader chose for the canvas, in the view band's menu (decision e_yxp78scv): kept in this browser, the same for every pane.

/** fit: all of it brought into sight on every change until the reader moves it; else the reader alone moves it. The key is the style's (key). */
const settings = { fit: true, snap: false };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('pelago-canvas') ?? '{}'));
} catch {
  // Without storage, as it comes.
}
/** What the sheet covers on the right of a canvas; a sheet as wide as the page leaves nothing beside it. */
const covered = (host) => {
  if (document.body.dataset.sheet !== 'open' || sheet.offsetWidth >= innerWidth * 0.8) return 0;
  return Math.max(0, host.getBoundingClientRect().right - sheet.getBoundingClientRect().left);
};
/** What the bars cover of a canvas above and below: the query bar's foot, and the find bar's top, in the canvas's own frame. */
const bars = (host) => {
  const edge = (id, side) => { const el = document.getElementById(id); return el && !el.hidden ? el.getBoundingClientRect()[side] : undefined; };
  // The plane, which starts under the bars (ui/shell.css), else the canvas; a bar over another pane covers none of it.
  const box = (host.querySelector('.lf-stage') ?? host).getBoundingClientRect();
  const over = (id) => { const r = document.getElementById(id)?.getBoundingClientRect(); return r && r.right > box.left && r.left < box.right; };
  const foot = (over('query') && edge('query', 'bottom')) || (over('nav') && edge('nav', 'bottom')) || box.top, find = over('find') ? edge('find', 'top') : undefined;
  return [Math.max(0, foot - box.top), find === undefined ? 0 : Math.max(0, box.bottom - find)];
};
const fitAll = () => all.forEach((c) => c.fit());
function toggle(name) {
  settings[name] = !settings[name];
  try {
    localStorage.setItem('pelago-canvas', JSON.stringify(settings));
  } catch {
    // Kept until the page is reloaded.
  }
  all.forEach((c) => (c.snap(), c.fit(true)));
}
// What the band's menu (ui/canvas-menu.js) acts on: Arrange the pane in focus, and the reader's toggles.
hooks.canvasNow = { arrange: () => current?.arrange(), settings, toggle };
// The sheet opening or shutting, and the window resized, change the room each is fitted to.
new MutationObserver(fitAll).observe(document.body, { attributes: true, attributeFilter: ['data-sheet'] });
addEventListener('resize', fitAll);
