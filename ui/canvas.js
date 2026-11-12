// A canvas: the map drawn in a pane (ui/panes.js), every pane alike. What is drawn is a flat lens (a filter, a walk and
// a limit: decision e_sdsaxxq4), kept as the pane's address (v?..., ui/tabs.js) and shown and edited in the query bar
// (ui/query-bar.js) while its pane is in focus: every change of what is drawn is a change of that lens. A click on an
// item opens its page and leaves the lens as it was (decision e_jedng69e); the find bar sets its words. It is drawn in the drawing its style names (the
// flow, by the canvas pack's preset, unless a nearer style says otherwise), so a canvas has no look of its own: it keeps
// which lens is up, lights the item whose page is open, and is fitted on every change until the reader moves it
// themselves (a page opened or shut then leaves it be).

import { api, hooks, idsOf, state } from './base.js';
import { wiresOn } from './canvas-wires.js';
import { catchUp } from './catch-up.js';
import { canvasSwitch } from './canvases.js';
import { numberOf } from './query-base.js';
import { FOCUS, addressOf, flatView } from './query.js';
import { drawQuery } from './query-bar.js';
import { unfollow } from './replica.js';

/**
 * Home: what agents' recent work reaches that needs attention now (the frontier, the same answer a session starts
 * with: decision e_gsxbzvxe), whatever waits on the viewer, and open projects (what stands at a project's altitude),
 * with no walk and a short limit, so the first canvas answers one question (decision e_5stjvfvb). Growing it is a step
 * taken from an item.
 */
export const home = () => ({
  filter: { find: ['frontier', 'waits_on me', ...(state.schema?.types ?? []).filter((t) => !t.dormant && t.altitude === 'project').map((t) => `type ${t.id}`)], not: ['done', 'kind system'] },
  limit: numberOf(state.style, 'home_limit'),
});
/** The canvas an item's address opens when no lens is asked: the item and what it holds, depends on and waits on. */
export const focusOn = (id) => ({ filter: { find: [`id ${id}`] }, walk: { over: FOCUS, steps: 1 } });
/**
 * What a picture is kept under in this browser: the saved view up (ui/canvases.js), and the form it is laid out in.
 * Nothing is put by hand on it: every view is drawn from its query's answer alone, the same each time it is asked, and
 * no step can be dragged (the owner, 3 Nov 2026: Home wore down under places put on other pictures). `flow` here names
 * no pack, only that the form asked for is the canvas's own.
 */
const canvasOf = (asked) => `${asked?.canvas ?? ''}@${asked?.shape && asked.shape !== 'flow' ? asked.shape : 'wired'}`;

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
export const queryNow = () => current?.lens ?? null;
/** Draw this lens in the canvas in focus. */
export const goQuery = (lens) => current?.pane.go(lens);
/** Open an address in the canvas in focus: a saved canvas, or a lens in a style, as the bar's switches do. */
export const openHere = (href) => current?.pane.open(href);
/** The style the canvas in focus was asked for (a shape, a style kept by id, the saved canvas up). */
export const styleNow = () => current?.asked ?? {};
/** Draw the lens up in a style, as the style switch does: a shape, a style kept by its id, or neither for the house's. */
export const drawIn = (style) => {
  const { shape: _s, style: _k, ...rest } = styleNow();
  openHere(`#/v?${addressOf(queryNow() ?? home(), { ...rest, ...style })}`);
};
/** Open an item's page over the canvas in focus, the lens as it is. */
export const openOver = (id) => current?.pane.opened(id, queryNow() ?? home());
/** Whether the canvas in focus draws this item now. */
export const canvasHas = (id) => Boolean(current?.has(id));
/** Light this item in the canvas in focus (its page is open), or none. */
export const mark = (here) => current?.mark(here);
/**
 * Read every canvas's lens again, each drawn again only if its answer differs: after something made here, which a lens
 * may now reach. When the map only changed under the page (`tail`), a canvas held in a store is already kept current by
 * the facts (packs/surface/page/replica.js), and is not read again.
 */
export const refreshCanvas = (tail = false) => all.forEach((c) => c.refresh(tail));
/**
 * Read again each canvas that draws one of these sessions: what the server says of a session on its node (its state and
 * the line of its latest beat) is worked out as the lens is read, not kept current by the facts, so a beat asks again.
 */
export const refreshSessions = (runs) => all.forEach((c) => runs.some((run) => c.has(run)) && c.refresh());

/**
 * A canvas drawn in `host`, for a pane: `pane.go(lens)` draws another lens there (null for Home), `pane.open(href)`
 * another saved canvas, `pane.opened(id, lens)` opens an item's page from a click on it, over that lens.
 */
export function canvasIn(host, pane) {
  /** What is up: the lens asked for, the view drawing it, the item lit in it, the style as asked, where it was left. */
  let at = null;
  /** Where it stands, if the reader has moved it from where it was fitted. */
  const moved = () => {
    const now = c.moves()?.state();
    return now && !['s', 'x', 'y'].every((k) => now[k] === at?.fitted?.[k]) ? now : null;
  };
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
    /** Draw this lens (Home when it is null), the item `here` lit, unless it is up already: then only what is lit changes. */
    show(lens, here, asked = {}) {
      const isHome = !lens;
      lens ??= home();
      const key = JSON.stringify([lens, asked]);
      if (at?.key === key && at.view.isConnected) return c.mark(here);
      const style = { ...asked, ...(here && { here }), ...(asked.canvas && { play: 'asked' }) };
      // The same lens drawn again (an item's page opened over it says it anew) stays where the reader moved it, and one
      // they have not moved fits the room beside the page.
      const same = at && JSON.stringify(at.lens) === JSON.stringify(lens);
      at = { key, view: null, lens, home: isHome, here, kept: same ? (c.moves() ? moved() : at.kept) : null, fitted: same ? at.fitted : null, style, asked };
      c.draw();
    },
    /** Draw nothing: a replay's pane before its first milestone (ui/panes.js). */
    empty() {
      if (at?.view?.store) unfollow(at.view.store);
      at = null;
      host.replaceChildren();
    },
    /** Draw the lens up now anew. */
    draw() {
      const of = idsOf(at.lens.filter)[0];
      // A kept view up plays its steps, if it keeps any (from the map as it is, when Play is pressed: style.play).
      const view = flatView({ lens: at.lens, style: at.style, of, key: `canvas:${canvasOf(at.asked)}`, played: at.style.canvas });
      // The picture it replaces stops being kept current from the log.
      if (at.view?.store) unfollow(at.view.store);
      at.view = view;
      // The bar says the lens at once, and again with what its answer found (the names of the items it names, a cut).
      view.addEventListener('lens-answer', () => at?.view === view && current === c && barNow());
      if (current === c) barNow();
      host.replaceChildren(view);
      // The first canvas a page draws is caught up from where its reader last looked (ui/catch-up.js).
      view.ready?.then(() => catchUp(view.store)).catch(() => {});
    },
    mark(here) {
      if (!at || at.here === here) return;
      at.here = here;
      at.view.mark?.(here);
    },
    has: (id) => Boolean(at?.view?.answer?.items.some((i) => i.id === id)),
    /** The ids of what it draws now. */
    ids: () => (at?.view?.answer?.items ?? []).map((i) => i.id),
    refresh: (tail = false) => (tail && at?.view?.store ? undefined : at?.view?.refresh?.()),
    /** The frame the drawing moves in now, and what moves it (packs/walls/page/pan-zoom.js). */
    moves: () => at?.view?.querySelector('.lens-view')?.moves,
    /**
     * All of it in sight, beside the sheet and between the bars, unless the reader has moved it since its lens was
     * drawn: a page opened or shut, or the window resized, does not undo their move.
     */
    fit() {
      if (at?.kept) return;
      if (at) at.kept = null;
      c.moves()?.fit(0, ...bars(host));
      if (at) at.fitted = c.moves()?.state();
    },
    /** Stop: its picture is no longer kept current from the log. */
    close() {
      if (at?.view?.store) unfollow(at.view.store);
      all.delete(c);
      if (current === c) current = null;
    },
  };
  all.add(c);
  // Where the reader left it, each time they move it: a drawing drawn again (the map changed) is put back there. A click
  // that moved nothing leaves it where it was fitted, so it is fitted again.
  const keepIt = () => at && c.moves() && (at.kept = moved() ?? at.kept);
  for (const name of ['pointerup', 'wheel']) host.addEventListener(name, () => setTimeout(keepIt, 0), { passive: true });
  // Its frame changing size (a story's milestone coming in beside it) fits it again, as a page opened or shut does:
  // never once the reader has moved it. At the next frame, once the plane has kept its middle (packs/walls/page/pan-zoom.js).
  const sized = new ResizeObserver(() => requestAnimationFrame(() => c.fit()));
  // A drawing mounted anew (a new view, the map changed under it): back where the reader left it, else fitted.
  new MutationObserver((list) => {
    if (!list.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches('.lf-stage') || n.querySelector?.('.lf-stage'))))) return;
    sized.disconnect();
    const stage = host.querySelector('.lf-stage');
    if (stage) sized.observe(stage);
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
// The pulse says which items changes touched (packs/surface/page/live.js): one of these, now tied, becomes the focus of the pane in focus.
hooks.sessionsTold = refreshSessions;
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

// ---- Where a canvas fits: always all of it in sight, until the reader moves it (the owner, 9 Nov 2026: no Fit toggle).

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
// The window resized, or the panes drawn again as the sheet opens or shuts (ui/panes.js), change the room each is fitted to.
addEventListener('resize', fitAll);
