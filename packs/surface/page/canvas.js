// A canvas: the map drawn in a pane (ui/panes.js), every pane alike. What is drawn is a flat lens (a filter, a walk and
// a limit: decision e_sdsaxxq4), kept as the pane's address (v?..., ui/tabs.js) and shown and edited in the query bar
// (the bar pack's parts, ./bar-band.js) while its pane is in focus: every change of what is drawn is a change of that lens. A click on an
// item opens its page and leaves the lens as it was (decision e_jedng69e); the find bar sets its words. It is drawn in the drawing its style names (the
// flow, by the canvas pack's preset, unless a nearer style says otherwise), so a canvas has no look of its own: it keeps
// which lens is up, lights the item whose page is open, and is fitted on every change until the reader moves it
// themselves (a page opened or shut then leaves it be).

import { api, drawSlot, drawSlots, h, hooks, idsOf, state, whoami } from './base.js';
import { wiresOn } from './canvas-wires.js';
import { canvasSwitch } from './views-kept.js';
import { added, moved, numberOf } from './query-base.js';
import { FOCUS, addressOf, flatView, readAddress } from './query.js';
import { drawBand } from './bar-band.js';
import { unfollow } from './replica.js';

/** The trace overlay over the canvases: the catch_up pack's parts, drawn once a page in a node of their own. */
let overlay;
const actorOf = (a) => (typeof a === 'string' ? a : a?.kind ? `${a.kind}:${a.name}` : undefined);
/**
 * Catch the first canvas up from where its reader last looked: the overlay (the slot `traces`, handed the person as
 * `me`) is mounted and told what was missed (hooks.tellMissed, packs/surface/page/live.js), which it traces and offers
 * to play.
 */
async function caughtUp(view) {
  if (!overlay) {
    overlay = h('div', { id: 'traces' });
    document.body.append(overlay);
    const me = await whoami().then((j) => actorOf(j?.actor), () => undefined);
    await drawSlots(overlay, { slot: 'traces', piece: { ...(me && { me }) } });
  }
  return hooks.tellMissed?.(view);
}

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
 * What a picture is kept under in this browser: the saved view up (packs/surface/page/views-kept.js), and the form it is laid out in.
 * Nothing is put by hand on it: every view is drawn from its query's answer alone, the same each time it is asked, and
 * no step can be dragged (the owner, 3 Nov 2026: Home wore down under places put on other pictures). `flow` here names
 * no pack, only that the form asked for is the canvas's own.
 */
const canvasOf = (asked) => `${asked?.canvas ?? ''}@${asked?.shape && asked.shape !== 'flow' ? asked.shape : 'wired'}`;

/** Every canvas drawn now, and the one the bar and find act on: the pane in focus (decision e_h2pqjy2q). */
const all = new Set();
let current = null;
/** The store of the canvas drawn round `node` (a part over it, a replay: ./replay.js), by name so nothing imports this file for it. */
// The overlay of traces stands over no one canvas: it plays on the one whose store holds what was missed (live.js).
hooks.storeUnder = (node) => ([...all].find((c) => c.host?.contains(node)) ?? [...all].find((c) => c.view?.store?.store?.missed))?.view?.store?.store ?? null;
/** Make this canvas the one the bar acts on. */
export function activate(c) {
  if (current && current !== c) hooks.partsAway?.();
  current = c;
  barNow();
}
function barNow() {
  const c = current;
  mountBar();
  if (c?.view) drawBand(c.lens, c.view, canvasSwitch(c.lens, c.asked, c.home, c.pane.open));
  hooks.addressMoved?.();
}
/**
 * Find's line and the rows above it, the bar pack's parts (`bar.find`, `bar.find.rows`): mounted once, in the nodes find
 * holds them in, and handed the lens and its answer as they move (./part-lens.js).
 */
let barMounted = false;
function mountBar() {
  if (barMounted) return;
  barMounted = true;
  for (const [slot, id] of [['bar.find', 'find-lens'], ['bar.find.rows', 'find-rows']]) {
    const node = document.getElementById(id);
    if (node) drawSlot(node, { slot }).catch((err) => console.warn(`${slot}: ${err?.message ?? err}`));
  }
}
/** What the canvas in focus drew last, as the slots drawn from its query are handed it, and whether reading it failed. */
hooks.answer = () => (current?.view ? { answer: current.view.answer, failed: current.view.failed } : null);
/** The lens Home draws, handed where no query is up. */
hooks.homeLens = () => home();
/** The lens the canvas in focus draws now. */
export const queryNow = () => current?.lens ?? null;
/** Draw this lens in the canvas in focus. */
export const goQuery = (lens) => current?.pane.go(lens);
/** Open an address in the canvas in focus: a saved canvas, or a lens in a style, as the bar's switches do. */
export const openHere = (href) => current?.pane.open(href);
/** The style the canvas in focus was asked for (a shape, a style kept by id, the saved canvas up). */
export const styleNow = () => current?.asked ?? {};
/** Draw the lens up in a style, as the style switch does: a shape, a style kept by its id, or neither for the house's. */
export const drawIn = (style, lens = queryNow()) => {
  const { shape: _s, style: _k, ...rest } = styleNow();
  openHere(`#/v?${addressOf(lens ?? home(), { ...rest, ...style })}`);
};
/** Open an item's page over the canvas in focus, the lens as it is. */
export const openOver = (id) => current?.pane.opened(id, queryNow() ?? home());
/**
 * The address a part that declares `go` is handed (packs/surface/page/part-host.js): the query the canvas in focus
 * draws (null for Home), the layout it was asked for, the item whose page is open, and how much its answer drew.
 */
hooks.address = () => {
  if (!current) return null;
  const { shape, style, canvas } = styleNow();
  const answer = current.view?.answer;
  return {
    query: current.home ? null : current.lens,
    layout: { ...(shape && { shape }), ...(style && { style }), ...(canvas && { canvas }) },
    ...(current.here && { item: current.here }),
    drawn: { count: answer?.items?.length ?? 0, ids: (answer?.items ?? []).slice(0, idsHanded).map((i) => i.id), ...(answer?.cut && { cut: true }) },
  };
};
/** How many of the ids drawn a part is handed in the address, for what a term would add or take away. */
const idsHanded = 500;
/** The pages of the app a part may name in an address (`page`), each one the host draws over the canvas. */
const PAGES_GO = ['you', 'workspace', 'screen'];
/** A name a layout goes by in an address: a shape's or a kept style's. */
const NAMED = /^[A-Za-z0-9_.-]{1,80}$/;
/**
 * Move the canvas in focus where a part says (its `go`, after a gesture): an item's page over it, or a query (null for
 * Home) in the layout named, else the one up. The query is said as an address and read back, so only what an address
 * can say is drawn.
 */
hooks.go = (address) => {
  if (!current || !address || typeof address !== 'object') return;
  if (typeof address.item === 'string' && /^e_[a-z0-9]{8}$/.test(address.item)) {
    // Following the reading (`replace`, the sheet's part after the person scrolled): the page in sight in place of the one
    // open, a step of no one's history, and never over words not yet saved.
    if (!address.replace) return void openOver(address.item);
    const open = /^#\/e\/(e_[a-z0-9]{8})/.exec(location.hash);
    if (!open || document.querySelector('#sheet [data-draft="unsaved"]')) return;
    return void location.replace(location.hash.replace(open[1], address.item));
  }
  // A page of the app the host draws, by name: what the menu leads to, so a part may go there without knowing an address.
  if (typeof address.page === 'string') {
    if (!PAGES_GO.includes(address.page)) return;
    // A screen by its id: one kept on the map (e_...) or one a pack offers (core.run_worked).
    const of = typeof address.of === 'string' && /^(?:e_[a-z0-9]{8}|[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)*)$/.test(address.of) ? address.of : undefined;
    if (address.page === 'screen' && !of) return;
    return void openHere(address.page === 'screen' ? `#/s/${encodeURIComponent(of)}` : `#/${address.page}`);
  }
  // A saved view, by its id: opened as the bar's switcher opens one (hooks.openView, packs/surface/page/views-kept.js).
  if (typeof address.view === 'string' && /^e_[a-z0-9]{8}$/.test(address.view)) return void hooks.openView?.(address.view);
  // A term added to the lens up or taken out of it (`add`, `take`): the runtime makes the lens, so no part keeps the algebra.
  if (address.add || address.take) {
    const next = moved(current.home ? home() : current.lens, address);
    return void (next && goQuery(next));
  }
  let lens = null;
  try {
    if (address.query) lens = readAddress(addressOf(address.query)).lens;
  } catch {
    return;
  }
  if (!address.layout || typeof address.layout !== 'object') return void goQuery(lens);
  const layout = Object.fromEntries(['shape', 'style'].map((k) => [k, address.layout[k]]).filter(([, v]) => typeof v === 'string' && NAMED.test(v)));
  // The kept view it is drawn as, when the address says (a view just saved), or none (`canvas: null`, one deleted).
  if (!('canvas' in address.layout)) return void drawIn(layout, lens);
  const { shape: _s, style: _k, canvas: _c, ...rest } = styleNow();
  const canvas = typeof address.layout.canvas === 'string' && /^e_[a-z0-9]{8}$/.test(address.layout.canvas) ? address.layout.canvas : undefined;
  openHere(`#/v?${addressOf(lens ?? home(), { ...rest, ...layout, ...(canvas && { canvas }) })}`);
};

/** Whether the canvas in focus draws this item now. */
export const canvasHas = (id) => Boolean(current?.has(id));
/** Light this item in the canvas in focus (its page is open), or none. */
/** The item whose page is open over the canvas: lit in the canvas in focus now, and in a canvas drawn while it is open. */
let pageHere;
export const mark = (here) => ((pageHere = here), current?.mark(here));
/**
 * Read every canvas's lens again, each drawn again only if its answer differs: after something made here, which a lens
 * may now reach. When the map only changed under the page (`tail`), a canvas held in a store is already kept current by
 * the facts (packs/surface/page/replica.js), and is not read again.
 */
export const refreshCanvas = (tail = false) => all.forEach((c) => c.refresh(tail));

/**
 * What a person makes on the canvas stays in sight, and the canvas stays the one they had (the owner, 10 Nov 2026): its
 * query is kept as it was, and only what it would not find is added to it, a term each (an item by its id, a new island
 * by `island <id>`), as a click adds to the filter. Whether the query finds it is the server's to judge (the page never
 * runs a query, packs/surface/page/membership.js): asked once, and the canvas read again either way. `made` is
 * [{ id, term }]. By name (hooks.keepInView), so a drawing's step (packs/walls/page/layout-asks.js) reaches it.
 */
hooks.keepInView = async (made) => {
  const lens = queryNow();
  if (!lens?.filter || !made.length) return refreshCanvas();
  const answer = await api('view', { name: 'flat', params: { filter: lens.filter, ...(lens.walk && { walk: lens.walk }), ...(lens.limit && { limit: lens.limit }) } }).catch(() => null);
  const found = new Set((answer?.items ?? []).map((i) => i.id));
  const missing = made.filter((m) => !found.has(m.id));
  if (!answer || !missing.length) return refreshCanvas();
  // Each missing item's term joins Find; a lens that named a view becomes a filter of the map again.
  const { view: _view, ...rest } = lens;
  goQuery(missing.reduce((l, m) => added(l, { find: m.term }), rest));
};
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
    /** The item lit in it, whose page is open. */
    get here() {
      return at?.here ?? null;
    },
    get view() {
      return at?.view ?? null;
    },
    get style() {
      return at?.style ?? null;
    },
    /** Draw this lens (Home when it is null), the item `here` lit, unless it is up already: then only what is lit changes. */
    show(lens, here, asked = {}) {
      // A pane drawn while an item's page is open over it lights that item: the address a pane is given names no item.
      here ??= pageHere;
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
      // The first canvas a page draws is caught up from where its reader last looked (caughtUp).
      view.ready?.then(() => caughtUp(view.store)).catch(() => {});
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
