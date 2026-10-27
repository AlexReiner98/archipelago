// Panes: more than one canvas in sight at once, docked side by side as a code editor's groups are, or popped out
// into a window of their own and docked back. The main pane is the canvas the address draws (ui/canvas.js), and the
// sheet opens over it; every other pane draws a lens of its own (a saved canvas, or the lens the main pane had when it
// was split), held in its own store and kept current from the log as the main one is (ui/live.js). Every pane is live:
// the query bar and find act on the one last touched (decision e_h2pqjy2q), and each pane keeps its own back and
// forward, a step for each lens it was given, not for a page opened over it (e_ssnyd3ex). Where the panes stand is the reader's, kept in this browser for each workspace, as the canvas's
// settings are: never on the map, and meaning nothing. An agent arranges them with report show and its `pane`. Each
// pane follows everyone, one session or nobody, as the reader picks in the bar; where a step lands is ui/pane-route.js.

import { api, h, hooks, known, store } from './base.js';
import { activate, canvasHref, focusOn, home, sheetOver, withItem } from './canvas.js';
import { canvasLens } from './canvases.js';
import { flatQuery, flatView, readFlatLens } from './lens.js';
import { lookMode } from './look.js';
import { busy, windowOf, windows } from './pane-busy.js';
import { dragPane, sashes } from './pane-drag.js';
import { heard, nameOf, route, sessionOf } from './pane-route.js';
import { unfollow } from './replica.js';
import { titles } from './words.js';

/** A window popped out of the main one draws one pane as its main canvas, and docks it back from its bar. */
const popped = window.name.startsWith('pelago-pane:') ? window.name.slice('pelago-pane:'.length) : null;
export const isPopped = () => Boolean(popped);
/** The sides a pane is docked on, beside the pane it is put by: along a row, or down a column. */
const SIDES = { left: ['row', 0], right: ['row', 1], above: ['column', 0], below: ['column', 1] };

// ---- The layout: the groups in one row or one column, main among them, each its share; and the panes popped out.

const key = () => `pelago-panes:${Object.entries(known.all()).find(([, w]) => w.token && w.token === store.token)?.[0] ?? 'here'}`;
const fresh = () => ({ dir: 'row', groups: ['main'], sizes: [1], panes: {}, main: {} });
function read() {
  try {
    const got = JSON.parse(localStorage.getItem(key()) ?? 'null');
    if (got?.groups?.includes('main') && got.sizes?.length === got.groups.length) return { main: {}, ...got };
  } catch {
    // Without storage, one pane.
  }
  return fresh();
}
let layout = read();
function keep() {
  try {
    localStorage.setItem(key(), JSON.stringify(layout));
  } catch {
    // Kept until the page is reloaded.
  }
}
const even = () => (layout.sizes = layout.groups.map(() => 1 / layout.groups.length));
const docked = () => layout.groups.filter((g) => g !== 'main');
/** Along a row on a page wider than tall; a row on a page taller than wide is drawn as a column. */
const dirNow = () => (layout.dir === 'row' && innerWidth < innerHeight ? 'column' : layout.dir);

// ---- What a pane draws: the address it was given (as an agent's show names a place: `v?…`, `e/<id>`), read as the
// main canvas reads its own.

/** The lens and style a pane's address names: a saved canvas named alone is read from the map. */
async function lensOf(at) {
  const [where, query = ''] = at.split('?');
  const asked = readFlatLens(query);
  // A saved canvas is named by its title, read from the map when the page does not know it yet.
  if (asked.style.canvas && !titles.has(asked.style.canvas) && asked.lens) await api('get', { id: asked.style.canvas }).then((got) => titles.set(got.entity.id, got.entity.title), () => {});
  if (asked.lens) return asked;
  if (asked.style.canvas) {
    const got = await api('get', { id: asked.style.canvas });
    titles.set(got.entity.id, got.entity.title);
    return canvasLens(got.entity);
  }
  const id = /^e\/(e_[a-z0-9]{8})/.exec(where)?.[1];
  return id ? { lens: focusOn(id), style: {} } : { lens: home(), style: {} };
}
/** Whether an address can be drawn in a pane: a canvas or an item's, not the workspace's sheet. */
const drawable = (at) => /^(v\b|e\/e_)/.test(at ?? '');
/** The saved canvas or item an address names first: two panes on it are the same pane. */
const named = (at) => /canvas=(e_[a-z0-9]{8})/.exec(at)?.[1] ?? /^e\/(e_[a-z0-9]{8})/.exec(at)?.[1] ?? at;

/** The panes drawn now, by id: { el, body, name, view, at, lens, asked, back, forth }. */
const drawn = new Map();

function paneEl(id) {
  const name = h('span', { class: 'pane-name', title: 'Drag to dock it elsewhere; out of the window to pop it out' }, 'Canvas');
  const mark = h('span', { class: 'pane-follows', hidden: true });
  const body = h('div', { class: 'pane-canvas' });
  const button = (title, mark, onclick) => h('button', { type: 'button', class: 'pane-act', title, 'aria-label': title, onclick }, mark);
  const el = h(
    'section',
    { class: 'pane', 'data-pane': id },
    h('header', { class: 'pane-bar' }, name, mark, button('Open it as the main canvas', '⤢', () => toMain(id)), button('Pop it out into a window of its own', '⧉', () => popOut(id)), button('Close this pane', '×', () => close(id))),
    body,
  );
  name.addEventListener('pointerdown', (ev) => dragPane(ev, id, el, { groups: groupEls, drop }));
  const entry = { el, body, name, mark, view: null, at: null, back: [], forth: [] };
  drawn.set(id, entry);
  fitOnMount(body);
  load(id, layout.panes[id].at);
  return el;
}

/** Draw this address in pane `id`, in place of what it drew: the pane, its name and its history stay. */
function load(id, at) {
  const entry = drawn.get(id);
  if (entry.view?.store) unfollow(entry.view.store);
  Object.assign(entry, { at, view: null });
  entry.body.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  lensOf(at)
    .then(({ lens, style }) => {
      if (drawn.get(id) !== entry || entry.at !== at) return;
      const canvas = style.canvas ?? lens.filter.ids?.[0] ?? '';
      entry.name.textContent = (style.canvas && titles.get(style.canvas)) || (lens.filter.ids?.length === 1 && titles.get(lens.filter.ids[0])) || lens.filter.text || 'Canvas';
      entry.name.title = `${entry.name.textContent}: drag to dock it elsewhere, out of the window to pop it out`;
      const placed = {};
      const view = flatView({ lens, style: { ...style, placed }, of: lens.filter.ids?.[0], key: `canvas:${canvas || 'map'}` });
      Object.assign(entry, { view, lens, asked: style });
      // Where things were put on this canvas is read as the main pane reads it, so it is drawn the same in both.
      api('places', canvas ? { canvas } : {}).then((got) => got && Object.keys(got).length && (Object.assign(placed, got), view.refresh?.()), () => {});
      // The bar says what the pane it acts on found, once it has.
      view.addEventListener('lens-answer', () => active === id && entry.view === view && activeIs(id));
      entry.body.replaceChildren(view);
      if (active === id) activeIs(id);
    })
    .catch((err) => entry.body.replaceChildren(h('div', { class: 'error' }, err.message)));
}

/** Give pane `id` another address: a step in its history, unless it is one taken back or forth. */
function goPane(id, at, step = true) {
  const entry = drawn.get(id);
  if (!entry || at === entry.at) return;
  if (step) (entry.back.push(entry.at), (entry.forth = []));
  layout.panes[id] = { ...layout.panes[id], at };
  keep();
  draw();
}
/** An address of the page (#/v?…, #/) as a pane's own. */
const asPane = (href) => href.replace(/^#\//, '') || 'v';

// ---- The pane the bar acts on: the one last touched. A press in a pane, or the focus going into a style's frame
// there (a frame keeps its presses to itself), makes it the one.

let active = 'main';
function activeIs(id) {
  if (id !== 'main' && !drawn.has(id)) id = 'main';
  active = id;
  for (const [g, e] of drawn) e.el.classList.toggle('pane-active', g === id);
  document.getElementById('canvas').classList.toggle('pane-active', id === 'main' && drawn.size > 0);
  document.body.dataset.active = id === 'main' ? 'main' : 'pane';
  frameActive();
  const e = drawn.get(id);
  activate(e?.view ? { lens: e.lens, asked: e.asked, view: e.view, go: (lens) => goPane(id, `v?${flatQuery(lens, e.asked)}`), open: (href) => goPane(id, asPane(href)) } : null);
}
const touched = (target) => {
  const pane = target?.closest?.('#panes > .pane');
  const id = pane ? pane.dataset.pane : target?.closest?.('#canvas, #main-name') ? 'main' : null;
  if (id && id !== active) activeIs(id);
};
addEventListener('pointerdown', (ev) => touched(ev.target), true);
addEventListener('blur', () => setTimeout(() => document.activeElement?.tagName === 'IFRAME' && touched(document.activeElement), 0));

/** A side of a frame as CSS: across, a share of the page; down, a share of what the band above leaves (ui/shell.css). */
const edge = (side, v) => {
  const share = (v * 100).toFixed(3);
  if (side === 'left' || side === 'right') return `${share}%`;
  return side === 'top' ? `calc(var(--band, 0%) + (100% - var(--band, 0%)) * ${share} / 100)` : `calc((100% - var(--band, 0%)) * ${share} / 100)`;
};
/** The frame of the pane the bar acts on, for the bar and find to sit in (ui/shell.css: --active-*). */
let frames = [];
function frameActive() {
  const box = frames.find(([g]) => g === active)?.[1] ?? frames.find(([g]) => g === 'main')?.[1];
  for (const side of ['left', 'right', 'top', 'bottom']) document.body.style.setProperty(`--active-${side}`, edge(side, box?.[side] ?? 0));
  // Out of focus, the main pane says its name in its strip, as a docked one does.
  mainName.hidden = active === 'main' || !drawn.size;
  const canvas = /canvas=(e_[a-z0-9]{8})/.exec(canvasHref())?.[1];
  mainName.textContent = (canvas && titles.get(canvas)) || 'Canvas';
  const whose = followsWord(layout.main);
  if (whose) mainName.append(h('span', { class: 'pane-follows' }, whose));
  for (const [g, e] of drawn) {
    const p = layout.panes[g];
    e.mark.textContent = [followsWord(p), p?.slot].filter(Boolean).join(' · ');
    e.mark.hidden = !e.mark.textContent;
  }
}
const mainName = document.body.appendChild(h('div', { id: 'main-name', hidden: true, title: 'The main canvas: press to work in it' }));

// ---- The main pane's back and forth: a step each time it draws another lens (ui/canvas.js tells), none for a page.

const main = { back: [], forth: [], at: null, travelling: false };
hooks.canvasMoved = () => {
  const href = canvasHref();
  if (main.at !== null && href !== main.at && !main.travelling) (main.back.push(main.at), (main.forth = []));
  main.travelling = false;
  main.at = href;
};
/** Back (-1) or forth (1) in the history of the pane the bar acts on. */
function travel(by) {
  const entry = active === 'main' ? null : drawn.get(active);
  const kept = entry ?? main;
  const [from, to] = by < 0 ? [kept.back, kept.forth] : [kept.forth, kept.back];
  if (!from.length) return;
  const next = from.pop();
  to.push(entry ? entry.at : main.at);
  if (entry) return goPane(active, next, false);
  main.travelling = true;
  location.hash = next;
}
const historyNow = () => (active === 'main' ? main : drawn.get(active)) ?? main;

/** A drawing on the plane mounted in a pane is brought into sight under the pane's bar. */
function fitOnMount(body) {
  new MutationObserver((list) => {
    if (!list.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches('.lf-stage') || n.querySelector?.('.lf-stage'))))) return;
    body.querySelector('.lens-view')?.moves?.fit(0, 0, 0);
  }).observe(body, { childList: true, subtree: true });
}

// A click on an item drawn in a pane adds it to that pane's filter, as one on the main canvas does, and opens its page
// in the sheet over the main canvas, which keeps what it draws.
addEventListener('click', (ev) => {
  const a = ev.target.closest?.('.pane-canvas a');
  const id = /^#\/e\/(e_[a-z0-9]{8})$/.exec(a?.getAttribute('href') ?? '')?.[1];
  if (!id || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
  ev.preventDefault();
  const pane = a.closest('#panes > .pane')?.dataset.pane;
  const entry = drawn.get(pane);
  if (entry?.lens) goPane(pane, `v?${flatQuery(withItem(entry.lens, id), entry.asked)}`);
  location.hash = sheetOver(id);
});

// ---- Drawing the layout: the main canvas's frame set by its share, each docked pane put beside it.

const host = document.getElementById('panes');
const groupEls = () => layout.groups.map((g) => [g, g === 'main' ? document.getElementById('canvas') : drawn.get(g)?.el]).filter(([, el]) => el);

function draw() {
  if (popped) return;
  for (const [id, entry] of drawn) if (!layout.groups.includes(id)) (entry.view?.store && unfollow(entry.view.store), entry.el.remove(), drawn.delete(id));
  for (const [id, entry] of drawn) if (layout.panes[id]?.at !== entry.at) load(id, layout.panes[id].at);
  const dir = dirNow();
  host.dataset.dir = dir;
  // Several panes share the room left of an open sheet, so none is behind it; one alone stays under it, as it was.
  const sheet = document.getElementById('sheet');
  const aside = layout.groups.length > 1 && document.body.dataset.sheet === 'open' && sheet.offsetWidth < innerWidth * 0.8 ? sheet.offsetWidth / innerWidth : 0;
  const room = 1 - aside;
  let from = 0;
  frames = layout.groups.map((g, n) => {
    const share = layout.sizes[n];
    const box = dir === 'row' ? { left: from * room, right: 1 - (from + share) * room, top: 0, bottom: 0 } : { top: from, bottom: 1 - from - share, left: 0, right: aside };
    from += share;
    return [g, box];
  });
  for (const [g, box] of frames) {
    if (g === 'main') {
      for (const side of ['left', 'right', 'top', 'bottom']) document.body.style.setProperty(`--main-${side}`, edge(side, box[side]));
      continue;
    }
    const el = drawn.get(g)?.el ?? paneEl(g);
    for (const side of ['left', 'right', 'top', 'bottom']) el.style[side] = edge(side, box[side]);
    if (el.parentNode !== host) host.append(el);
  }
  document.body.dataset.panes = String(layout.groups.length);
  if (active !== 'main' && !drawn.has(active)) activeIs('main');
  else frameActive();
  sashes(host, dir, frames, (n, share) => {
    const pair = layout.sizes[n] + layout.sizes[n + 1];
    const least = pair * 0.15;
    layout.sizes[n] = Math.min(pair - least, Math.max(least, share - layout.sizes.slice(0, n).reduce((a, b) => a + b, 0)));
    layout.sizes[n + 1] = pair - layout.sizes[n];
    keep();
    draw();
  });
  dispatchEvent(new Event('resize'));
}

// ---- Whose steps a pane follows: everyone (unset), nobody ('none'), or one session (its run, or the agent's name).

/** What a pane's strip says of whom it follows (`p`, as kept: whom, and the session's name when it was picked): nothing for everyone. */
function followsWord(p) {
  if (!p?.follows || p.follows === 'all') return null;
  return p.follows === 'none' ? 'Follows nobody' : heard.has(p.follows) ? nameOf(p.follows) : (p.named ?? nameOf(p.follows));
}
/** The reader picks whom pane `id` follows; a session it held lets go of it. */
function setFollows(id, follows) {
  const named = heard.has(follows) ? nameOf(follows) : undefined;
  if (id === 'main') layout.main = { ...layout.main, follows, named };
  else if (layout.panes[id]) layout.panes[id] = { ...layout.panes[id], follows, named };
  landed.delete(id);
  keep();
  frameActive();
}
/** The picker in the bar: everyone, nobody, the sessions heard from lately, newest first. */
function followsPicker(id) {
  const now = (id === 'main' ? layout.main?.follows : layout.panes[id]?.follows) ?? 'all';
  const sessions = [...heard].sort(([, a], [, b]) => b.at - a.at).map(([key]) => key);
  if (!['all', 'none', ...sessions].includes(now)) sessions.unshift(now);
  const pick = h(
    'select',
    { class: 'q-follows', title: 'Whose shows and changes this pane follows', 'aria-label': 'Whom this pane follows', onchange: (ev) => setFollows(id, ev.target.value) },
    h('option', { value: 'all' }, 'Everyone'),
    h('option', { value: 'none' }, 'Nobody'),
    ...sessions.map((key) => h('option', { value: key, title: key }, key === now ? (followsWord(id === 'main' ? layout.main : layout.panes[id]) ?? nameOf(key)) : nameOf(key))),
  );
  pick.value = now;
  return pick;
}

// ---- What can be done with a pane: open, move, close, make main, pop out and dock back.

const newId = () => `p${Math.random().toString(36).slice(2, 10)}`;
/**
 * Open this address in a pane on this side of the pane `by` (the main one, unless named); one already on it is moved
 * there. A pane opened for a session (`follows`, and the name it gave, `slot`) is its own, never one already open.
 */
export function openPane(at, side = 'right', by = 'main', own = {}) {
  if (!drawable(at)) return null;
  const same = !own.follows && Object.entries(layout.panes).find(([id, p]) => !p.popped && layout.groups.includes(id) && !p.follows && named(p.at) === named(at));
  const id = same?.[0] ?? newId();
  layout.panes[id] = { at, ...own };
  place(id, side, by);
  return id;
}
/** Put pane `id` on this side of group `by`: a side across the layout's direction turns it. */
function place(id, side, by) {
  const [dir, after] = SIDES[side] ?? SIDES.right;
  layout.groups = layout.groups.filter((g) => g !== id);
  if (layout.groups.length === 1 || dir !== layout.dir) layout.dir = dir;
  const at = Math.max(0, layout.groups.indexOf(by)) + after;
  layout.groups.splice(at, 0, id);
  even();
  keep();
  draw();
}
export function close(id) {
  layout.groups = layout.groups.filter((g) => g !== id);
  delete layout.panes[id];
  even();
  keep();
  draw();
}
/** Only the main pane. */
export function alone() {
  layout = { ...fresh(), panes: Object.fromEntries(Object.entries(layout.panes).filter(([, p]) => p.popped)) };
  keep();
  draw();
}
/** Swap: the pane's canvas becomes the main one, and what the main pane drew takes its place. */
function toMain(id) {
  const pane = layout.panes[id];
  layout.panes[id] = { at: asPane(canvasHref()) };
  keep();
  draw();
  activeIs('main');
  location.hash = `#/${pane.at}`;
}
/** Pop a pane out into a window of its own, as large as it was; the main page draws it no more until it is docked back. */
function popOut(id) {
  const el = drawn.get(id)?.el;
  const box = el?.getBoundingClientRect();
  const win = window.open(`${location.pathname}#/${layout.panes[id].at}`, `pelago-pane:${id}`, `popup,width=${Math.round(box?.width ?? innerWidth / 2)},height=${Math.round(box?.height ?? innerHeight)}`);
  if (!win) return;
  windows.set(id, win);
  layout.panes[id] = { ...layout.panes[id], popped: true };
  layout.groups = layout.groups.filter((g) => g !== id);
  even();
  keep();
  draw();
}
/** Let go of a pane dragged (ui/pane-drag.js): on a side of a group, docked there; in the middle of one, swapped; out of the window, popped out. */
function drop(id, target, zone) {
  if (zone === 'out') return popOut(id);
  if (zone !== 'center') return place(id, zone, target);
  if (target === 'main') return toMain(id);
  const [a, b] = [layout.groups.indexOf(id), layout.groups.indexOf(target)];
  [layout.groups[a], layout.groups[b]] = [target, id];
  keep();
  draw();
}

// In a window popped out: the pane follows where its canvas goes, docks back from the bar, and is let go when closed.
let docking = false;
/** Where the popped window stands: its address, which says its canvas once the page has drawn it. */
const here = () => location.hash.replace(/^#\//, '') || 'v';
function dockBack() {
  layout = read();
  const { popped: _, ...was } = layout.panes[popped] ?? {};
  layout.panes[popped] = { ...was, at: here() };
  layout.groups = [...layout.groups.filter((g) => g !== popped), popped];
  even();
  keep();
  docking = true;
  window.close();
}
if (popped) {
  document.body.dataset.popped = 'true';
  // Whom it follows stays with it: the main page sends it what its session shows.
  const mine = () => ((layout = read()), (layout.panes[popped] = { ...layout.panes[popped], at: here(), popped: true }), keep());
  addEventListener('hashchange', () => setTimeout(mine, 0));
  addEventListener('pagehide', () => {
    if (docking) return;
    layout = read();
    delete layout.panes[popped];
    keep();
  });
  // A reload of the popped window is a pagehide too: it keeps its pane again once it has drawn.
  setTimeout(mine, 0);
}
// What a popped window docked back, or another tab changed, is drawn here as it is kept.
addEventListener('storage', (ev) => ev.key === key() && ((layout = read()), draw()));
addEventListener('resize', () => {
  const dir = dirNow();
  if (host.dataset.dir !== dir) ((host.dataset.dir = dir), draw());
});
// The sheet opening or shutting changes the room the panes share.
new MutationObserver(() => started && !popped && layout.groups.length > 1 && draw()).observe(document.body, { attributes: true, attributeFilter: ['data-sheet'] });

/** The query bar's own: back and forth in the pane it acts on, and split (in a popped window, dock back). */
hooks.paneButtons = () => {
  const { back, forth } = historyNow();
  const button = (label, title, mark, onclick, off) => h('button', { type: 'button', class: 'q-save', title, 'aria-label': label, disabled: off, onclick }, mark);
  // A docked pane in focus has its names covered by the bar: what they offered is here, and it is dragged from ⠿.
  const entry = active === 'main' ? null : drawn.get(active);
  const grip = entry ? h('button', { type: 'button', class: 'q-save q-grip', title: 'Drag to dock this pane elsewhere; out of the window to pop it out', 'aria-label': 'Move this pane' }, '⠿') : null;
  grip?.addEventListener('pointerdown', (ev) => dragPane(ev, active, entry.el, { groups: groupEls, drop }));
  return [
    grip,
    !popped && followsPicker(active),
    button('Back', 'Back to what this pane drew before', '‹', () => travel(-1), !back.length),
    button('Forward', 'Forward again', '›', () => travel(1), !forth.length),
    popped
      ? button('Dock back', 'Dock this window back into the main one', '⇲', dockBack)
      : button('Split', 'Split: open this canvas in a pane beside it (drag the pane’s name to dock it elsewhere)', '◫', () => openPane(asPane(active === 'main' ? canvasHref() : `#/${entry.at}`), 'right', active)),
    entry && button('Make main', 'Open it as the main canvas', '⤢', () => toMain(active)),
    entry && button('Pop out', 'Pop it out into a window of its own', '⧉', () => popOut(active)),
    entry && button('Close', 'Close this pane', '×', () => close(active)),
  ].filter(Boolean);
};

/** When each pane last drew a session's step, by pane: a pane that follows everyone is that session's while it is at work. */
const landed = new Map();
/**
 * Open a window of its own for a session's pane, drawing this address: 'popped', or, where the browser holds back a
 * window no press opened, the way to open it from the line (ui/live.js), where a press may.
 */
function popNew(at, own) {
  const id = newId();
  const win = window.open(`${location.pathname}#/${at}`, `pelago-pane:${id}`, `popup,width=${Math.round(innerWidth / 2)},height=${Math.round(innerHeight)}`);
  if (!win) return { popOut: () => popNew(at, own) };
  windows.set(id, win);
  layout.panes[id] = { at, ...own, popped: true };
  keep();
  landed.set(id, { session: own.follows, at: Date.now() });
  return 'popped';
}
/**
 * Where an agent's step lands (ui/live.js), as ui/pane-route.js works it out from whom each pane follows and where the
 * reader is busy (ui/pane-busy.js): answers 'main' for the main canvas, which the address then moves; the frame of a
 * docked pane that draws it, or 'popped' for a window of its own; { popOut } where a window would be opened and the
 * browser will not without a press; or null where no pane takes it, and it is only offered.
 */
hooks.land = (step) => {
  if (popped) return null;
  const at = step.hash;
  const pane = (id, p) => ({ id, follows: p?.follows ?? 'all', slot: p?.slot, landed: landed.get(id), busy: busy(id), popped: p?.popped, draws: named(id === 'main' ? asPane(canvasHref()) : p.at) === named(at) });
  const out = Object.keys(layout.panes).filter((id) => layout.panes[id].popped && windowOf(id));
  const panes = [pane('main', layout.main), ...docked().map((g) => pane(g, layout.panes[g])), ...out.map((g) => pane(g, layout.panes[g]))];
  const now = Date.now();
  const others = [...heard].filter(([key, o]) => key !== sessionOf(step) && now - o.at < 600_000).length;
  const to = route(step, panes, { now, recent: 600_000, most: 4, others, drawable: drawable(at) });
  if (to.offer) return null;
  const session = sessionOf(step);
  if (to.pane === 'main') {
    if (to.side === 'alone') alone();
    landed.set('main', { session, at: Date.now() });
    return 'main';
  }
  if (to.open?.popped) return popNew(at, { follows: to.open.follows, named: nameOf(to.open.follows), ...(to.open.slot && { slot: to.open.slot }) });
  const win = to.pane && layout.panes[to.pane]?.popped ? windowOf(to.pane) : null;
  if (win) {
    win.location.hash = `#/${at}`;
    landed.set(to.pane, { session, at: Date.now() });
    return 'popped';
  }
  const id = to.open ? openPane(at, to.open.side, 'main', { follows: to.open.follows, named: nameOf(to.open.follows), ...(to.open.slot && { slot: to.open.slot }) }) : to.pane;
  if (!id) return null;
  if (to.side) place(id, to.side, 'main');
  goPane(id, at);
  landed.set(id, { session, at: Date.now() });
  const entry = drawn.get(id);
  if (!entry) return null;
  entry.el.classList.remove('pane-shown');
  void entry.el.offsetWidth;
  entry.el.classList.add('pane-shown');
  return entry.el.querySelector('.pane-canvas');
};

/** Draw the panes kept, once the map's schema is read (ui/app.js): what they draw is read through it. */
let started = false;
// A look's page (the server's own, ui/look.js) draws the view it was asked for alone.
export const startPanes = () => lookMode || started || ((started = true), draw());
