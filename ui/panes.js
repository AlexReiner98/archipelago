// Panes: more than one canvas in sight at once, docked side by side as a code editor's groups are, or popped out
// into a window of their own and docked back. The main pane is the canvas the address draws (ui/canvas.js), with the
// query bar, find and the sheet over it; every other pane draws a lens of its own (a saved canvas, or the lens the
// main pane had when it was split), held in its own store and kept current from the log as the main one is
// (ui/live.js). Where the panes stand is the reader's, kept in this browser for each workspace, as the canvas's
// settings are: never on the map, and meaning nothing. An agent arranges them with report show and its `pane`.

import { api, h, hooks, known, store } from './base.js';
import { canvasHref, focusOn, home, sheetOver } from './canvas.js';
import { canvasLens } from './canvases.js';
import { flatView, readFlatLens } from './lens.js';
import { dragPane, sashes } from './pane-drag.js';
import { unfollow } from './replica.js';
import { titles } from './words.js';

/** A window popped out of the main one draws one pane as its main canvas, and docks it back from its bar. */
const popped = window.name.startsWith('pelago-pane:') ? window.name.slice('pelago-pane:'.length) : null;
export const isPopped = () => Boolean(popped);
/** The sides a pane is docked on, beside the pane it is put by: along a row, or down a column. */
const SIDES = { left: ['row', 0], right: ['row', 1], above: ['column', 0], below: ['column', 1] };

// ---- The layout: the groups in one row or one column, main among them, each its share; and the panes popped out.

const key = () => `pelago-panes:${Object.entries(known.all()).find(([, w]) => w.token && w.token === store.token)?.[0] ?? 'here'}`;
const fresh = () => ({ dir: 'row', groups: ['main'], sizes: [1], panes: {} });
function read() {
  try {
    const got = JSON.parse(localStorage.getItem(key()) ?? 'null');
    if (got?.groups?.includes('main') && got.sizes?.length === got.groups.length) return got;
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

/** The panes drawn now, by id: { el, view, at }. */
const drawn = new Map();

function paneEl(id) {
  const pane = layout.panes[id];
  const name = h('span', { class: 'pane-name', title: 'Drag to dock it elsewhere; out of the window to pop it out' }, 'Canvas');
  const body = h('div', { class: 'pane-canvas' }, h('div', { class: 'empty' }, 'Loading…'));
  const button = (title, mark, onclick) => h('button', { type: 'button', class: 'pane-act', title, 'aria-label': title, onclick }, mark);
  const el = h(
    'section',
    { class: 'pane', 'data-pane': id },
    h('header', { class: 'pane-bar' }, name, button('Open it as the main canvas', '⤢', () => toMain(id)), button('Pop it out into a window of its own', '⧉', () => popOut(id)), button('Close this pane', '×', () => close(id))),
    body,
  );
  name.addEventListener('pointerdown', (ev) => dragPane(ev, id, el, { groups: groupEls, drop }));
  const entry = { el, view: null, at: pane.at };
  drawn.set(id, entry);
  lensOf(pane.at)
    .then(({ lens, style }) => {
      if (drawn.get(id) !== entry) return;
      const canvas = style.canvas ?? lens.filter.ids?.[0] ?? '';
      name.textContent = (style.canvas && titles.get(style.canvas)) || (lens.filter.ids?.length === 1 && titles.get(lens.filter.ids[0])) || lens.filter.text || 'Canvas';
      name.title = `${name.textContent}: drag to dock it elsewhere, out of the window to pop it out`;
      const placed = {};
      entry.view = flatView({ lens, style: { ...style, placed }, of: lens.filter.ids?.[0], key: `canvas:${canvas || 'map'}` });
      // Where things were put on this canvas is read as the main pane reads it, so it is drawn the same in both.
      api('places', canvas ? { canvas } : {}).then((got) => got && Object.keys(got).length && (Object.assign(placed, got), entry.view?.refresh?.()), () => {});
      body.replaceChildren(entry.view);
      fitOnMount(body);
    })
    .catch((err) => body.replaceChildren(h('div', { class: 'error' }, err.message)));
  return el;
}

/** A drawing on the plane mounted in a pane is brought into sight under the pane's bar. */
function fitOnMount(body) {
  new MutationObserver((list) => {
    if (!list.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches('.lf-stage') || n.querySelector?.('.lf-stage'))))) return;
    body.querySelector('.lens-view')?.moves?.fit(0, 0, 0);
  }).observe(body, { childList: true, subtree: true });
}

// A click on an item drawn in a pane opens its page in the sheet over the main canvas, which keeps what it draws.
addEventListener('click', (ev) => {
  const a = ev.target.closest?.('.pane-canvas a');
  const id = /^#\/e\/(e_[a-z0-9]{8})$/.exec(a?.getAttribute('href') ?? '')?.[1];
  if (!id || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
  ev.preventDefault();
  location.hash = sheetOver(id);
});

// ---- Drawing the layout: the main canvas's frame set by its share, each docked pane put beside it.

const host = document.getElementById('panes');
const groupEls = () => layout.groups.map((g) => [g, g === 'main' ? document.getElementById('canvas') : drawn.get(g)?.el]).filter(([, el]) => el);

function draw() {
  if (popped) return;
  for (const [id, entry] of drawn) if (!layout.groups.includes(id) || layout.panes[id]?.at !== entry.at) (entry.view?.store && unfollow(entry.view.store), entry.el.remove(), drawn.delete(id));
  const dir = dirNow();
  host.dataset.dir = dir;
  let from = 0;
  const frames = layout.groups.map((g, n) => {
    const share = layout.sizes[n];
    const box = dir === 'row' ? { left: from, right: 1 - from - share, top: 0, bottom: 0 } : { top: from, bottom: 1 - from - share, left: 0, right: 0 };
    from += share;
    return [g, box];
  });
  const pct = (v) => `${(v * 100).toFixed(3)}%`;
  for (const [g, box] of frames) {
    if (g === 'main') {
      for (const side of ['left', 'right', 'top', 'bottom']) document.body.style.setProperty(`--main-${side}`, pct(box[side]));
      continue;
    }
    const el = drawn.get(g)?.el ?? paneEl(g);
    for (const side of ['left', 'right', 'top', 'bottom']) el.style[side] = pct(box[side]);
    if (el.parentNode !== host) host.append(el);
  }
  document.body.dataset.panes = String(layout.groups.length);
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

// ---- What can be done with a pane: open, move, close, make main, pop out and dock back.

const newId = () => `p${Math.random().toString(36).slice(2, 10)}`;
/** Open this address in a pane on this side of the pane `by` (the main one, unless named); one already on it is moved there. */
export function openPane(at, side = 'right', by = 'main') {
  if (!drawable(at)) return null;
  const same = Object.entries(layout.panes).find(([id, p]) => !p.popped && layout.groups.includes(id) && named(p.at) === named(at));
  const id = same?.[0] ?? newId();
  layout.panes[id] = { at };
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
  const was = canvasHref().replace(/^#\//, '') || 'v';
  layout.panes[id] = { at: was };
  keep();
  draw();
  location.hash = `#/${pane.at}`;
}
/** Pop a pane out into a window of its own, as large as it was; the main page draws it no more until it is docked back. */
function popOut(id) {
  const el = drawn.get(id)?.el;
  const box = el?.getBoundingClientRect();
  const win = window.open(`${location.pathname}#/${layout.panes[id].at}`, `pelago-pane:${id}`, `popup,width=${Math.round(box?.width ?? innerWidth / 2)},height=${Math.round(box?.height ?? innerHeight)}`);
  if (!win) return;
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
  layout.panes[popped] = { at: here() };
  layout.groups = [...layout.groups.filter((g) => g !== popped), popped];
  even();
  keep();
  docking = true;
  window.close();
}
if (popped) {
  document.body.dataset.popped = 'true';
  const mine = () => ((layout = read()), (layout.panes[popped] = { at: here(), popped: true }), keep());
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

/** The query bar's split: this canvas opened beside, or, in a popped window, docked back. */
hooks.paneButton = () =>
  popped
    ? h('button', { type: 'button', class: 'q-save', title: 'Dock this window back into the main one', 'aria-label': 'Dock back', onclick: dockBack }, '⇲')
    : h('button', { type: 'button', class: 'q-save', title: 'Split: open this canvas in a pane beside it (drag the pane’s name to dock it elsewhere)', 'aria-label': 'Split', onclick: () => openPane(canvasHref().replace(/^#\//, '') || 'v', 'right') }, '◫');

/**
 * Where an agent's show lands (ui/live.js): `pane` as it asked (a side: opened there; alone: the other panes closed;
 * main: the main pane), else the docked pane already drawing what it names, else the main pane. Answers with the frame
 * that draws it, for its look, or null for the main canvas, which the address then moves.
 */
hooks.showIn = (at, pane) => {
  if (popped || !drawable(at)) return null;
  if (pane === 'alone') return void alone(), null;
  if (pane === 'main') return null;
  const id = SIDES[pane] ? openPane(at, pane) : docked().find((g) => named(layout.panes[g].at) === named(at));
  const entry = id && drawn.get(id);
  if (!entry) return null;
  entry.el.classList.remove('pane-shown');
  void entry.el.offsetWidth;
  entry.el.classList.add('pane-shown');
  return entry.el.querySelector('.pane-canvas');
};

/** Draw the panes kept, once the map's schema is read (ui/app.js): what they draw is read through it. */
let started = false;
export const startPanes = () => started || ((started = true), draw());
