// Panes: more than one canvas in sight at once in a tab (ui/tab-bar.js), docked side by side as a code editor's groups
// are; they stay together in their tab (decision e_mzer5m4t). The main pane is the canvas the address draws
// (ui/canvas.js), and the sheet opens over it; every other pane draws a lens of its own (a saved canvas, or the lens the
// main pane had when it was split), held in its own store and kept current from the log as the main one is
// (ui/live.js). Every pane is live: the query bar and find act on the one last touched (decision e_h2pqjy2q), and each
// pane keeps its own back and forward, a step for each lens it was given, not for a page opened over it (e_ssnyd3ex).
// Only the tab in sight is drawn; the others keep where their panes stand (ui/tabs.js). An agent arranges them with
// report show and its `pane`; where a step lands is ui/pane-route.js.

import { api, h, hooks } from './base.js';
import { activate, canvasHref, focusOn, home, sheetOver, withItem } from './canvas.js';
import { canvasLens } from './canvases.js';
import { flatQuery, flatView, readFlatLens } from './lens.js';
import { dragPane, sashes } from './pane-drag.js';
import { filterSaid } from './query-bar.js';
import { unfollow } from './replica.js';
import { asPane, drawable, front, keep, named, newId } from './tabs.js';
import { titles } from './words.js';

/** The sides a pane is docked on, beside the pane it is put by: along a row, or down a column. */
const SIDES = { left: ['row', 0], right: ['row', 1], above: ['column', 0], below: ['column', 1] };

// ---- The layout of the tab in sight: its groups in one row or one column, main among them, each its share.

const even = (t = front()) => (t.sizes = t.groups.map(() => 1 / t.groups.length));
/** Along a row on a page wider than tall; a row on a page taller than wide is drawn as a column. */
const dirNow = () => (front().dir === 'row' && innerWidth < innerHeight ? 'column' : front().dir);

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

/** The panes drawn now, by id: { el, body, name, view, at, lens, asked, back, forth }. */
export const drawn = new Map();

function paneEl(id) {
  const name = h('span', { class: 'pane-name', title: 'Drag to dock it elsewhere' }, 'Canvas');
  const mark = h('span', { class: 'pane-follows', hidden: true });
  const body = h('div', { class: 'pane-canvas' });
  const button = (title, mark, onclick) => h('button', { type: 'button', class: 'pane-act', title, 'aria-label': title, onclick }, mark);
  // Its controls stand in its strip in focus or not: in focus, the query bar takes the name's place between them.
  const grip = h('span', { class: 'pane-act pane-grip', title: 'Drag to dock it elsewhere', 'aria-label': 'Move this pane' }, '⠿');
  const el = h('section', { class: 'pane', 'data-pane': id }, h('header', { class: 'pane-bar' }, grip, name, mark, button('Open it as the main canvas', '⤢', () => toMain(id)), button('Close this pane', '×', () => close(id))), body);
  for (const handle of [grip, name]) handle.addEventListener('pointerdown', (ev) => dragPane(ev, id, el, { groups: groupEls, drop }));
  const entry = { el, body, name, mark, view: null, at: null, back: [], forth: [] };
  drawn.set(id, entry);
  fitOnMount(body);
  load(id, front().panes[id].at);
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
      // Named as its tab would be: a saved canvas by its name, else by what its filter finds.
      const naming = () => {
        entry.name.textContent = (style.canvas && titles.get(style.canvas)) || filterSaid(lens.filter, naming) || 'Canvas';
        entry.name.title = `${entry.name.textContent}: drag to dock it elsewhere`;
      };
      naming();
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

/** Give pane `id` of the tab in sight another address: a step in its history, unless it is one taken back or forth. */
export function goPane(id, at, step = true) {
  const entry = drawn.get(id);
  if (!entry || at === entry.at) return;
  if (step) (entry.back.push(entry.at), (entry.forth = []));
  front().panes[id] = { ...front().panes[id], at };
  keep();
  draw();
}

// ---- The pane the bar acts on: the one last touched. A press in a pane, or the focus going into a style's frame
// there (a frame keeps its presses to itself), makes it the one.

let active = 'main';
/** The tab and pane the bar last acted on: when it moves to another, the bar and find start afresh there. */
let focused = '';
export function activeIs(id) {
  if (id !== 'main' && !drawn.has(id)) id = 'main';
  active = id;
  // Each tab keeps the pane last touched in it, for when it is brought into sight again (decision e_x9b9yv5g, asked).
  const t = front();
  if (t && t.focus !== id) ((t.focus = id), keep());
  if (focused !== `${t?.id}:${id}`) ((focused = `${t?.id}:${id}`), dispatchEvent(new Event('pane-focus')));
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
  // Out of focus, the main pane says its name in its strip, as a docked one does, and the name an agent gave it.
  mainName.hidden = active === 'main' || !drawn.size;
  const href = canvasHref();
  const canvas = /canvas=(e_[a-z0-9]{8})/.exec(href)?.[1];
  mainName.textContent = (canvas && titles.get(canvas)) || (href === '#/' ? 'Home' : filterSaid(readFlatLens(href.split('?')[1] ?? '').lens.filter, frameActive)) || 'Canvas';
  if (front().slot) mainName.append(h('span', { class: 'pane-follows' }, front().slot));
  for (const [g, e] of drawn) {
    e.mark.textContent = front().panes[g]?.slot ?? '';
    e.mark.hidden = !e.mark.textContent;
  }
}
const mainName = document.body.appendChild(h('div', { id: 'main-name', hidden: true, title: 'The main canvas: press to work in it' }));

// ---- The main pane's back and forth, for each tab: a step each time it draws another lens (ui/canvas.js tells), none for a page.

const mains = new Map();
const mainOf = () => (mains.has(front().id) || mains.set(front().id, { back: [], forth: [], at: null, travelling: false }), mains.get(front().id));
hooks.canvasMoved = () => {
  const main = mainOf();
  const href = canvasHref();
  if (main.at !== null && href !== main.at && !main.travelling) (main.back.push(main.at), (main.forth = []));
  main.travelling = false;
  main.at = href;
};
/** Back (-1) or forth (1) in the history of the pane the bar acts on. */
function travel(by) {
  const entry = active === 'main' ? null : drawn.get(active);
  const kept = entry ?? mainOf();
  const [from, to] = by < 0 ? [kept.back, kept.forth] : [kept.forth, kept.back];
  if (!from.length) return;
  const next = from.pop();
  to.push(entry ? entry.at : kept.at);
  if (entry) return goPane(active, next, false);
  kept.travelling = true;
  location.hash = next;
}
const historyNow = () => (active === 'main' ? mainOf() : drawn.get(active)) ?? mainOf();

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

// ---- Drawing the tab in sight: the main canvas's frame set by its share, each docked pane put beside it.

const host = document.getElementById('panes');
const groupEls = () => front().groups.map((g) => [g, g === 'main' ? document.getElementById('canvas') : drawn.get(g)?.el]).filter(([, el]) => el);

export function draw() {
  const layout = front();
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

// ---- What can be done with a pane: open, move, close, make main.

/**
 * Open this address in a pane on this side of the pane `by` (the main one, unless named) in tab `t` (the one in
 * sight unless named); one already on it is moved there. A pane opened for a session by the name it gave (`slot`) is
 * its own, never one already open. Answers the pane's id.
 */
export function openPane(at, side = 'right', by = 'main', own = {}, t = front()) {
  if (!drawable(at)) return null;
  const same = !own.slot && Object.entries(t.panes).find(([id, p]) => t.groups.includes(id) && !p.slot && named(p.at) === named(at));
  const id = same?.[0] ?? newId('p');
  t.panes[id] = { at, ...own };
  place(id, side, by, t);
  return id;
}
/** Put pane `id` on this side of group `by` in tab `t`: a side across the tab's direction turns it. */
export function place(id, side, by, t = front()) {
  const [dir, after] = SIDES[side] ?? SIDES.right;
  t.groups = t.groups.filter((g) => g !== id);
  if (t.groups.length === 1 || dir !== t.dir) t.dir = dir;
  const at = Math.max(0, t.groups.indexOf(by)) + after;
  t.groups.splice(at, 0, id);
  even(t);
  keep();
  if (t === front()) draw();
}
export function close(id) {
  const t = front();
  t.groups = t.groups.filter((g) => g !== id);
  delete t.panes[id];
  even();
  keep();
  draw();
}
/** Only the main pane, in the tab in sight. */
export function alone() {
  Object.assign(front(), { dir: 'row', groups: ['main'], sizes: [1], panes: {} });
  keep();
  draw();
}
/** Swap: the pane's canvas becomes the main one, and what the main pane drew takes its place. */
function toMain(id) {
  const t = front();
  const pane = t.panes[id];
  t.panes[id] = { at: asPane(canvasHref()) };
  keep();
  draw();
  activeIs('main');
  location.hash = `#/${pane.at}`;
}
/** Let go of a pane dragged (ui/pane-drag.js): on a side of a group, docked there; in the middle of one, swapped. A pane stays in its tab: a tab, not a pane, pops out. */
function drop(id, target, zone) {
  if (zone === 'out') return;
  if (zone !== 'center') return place(id, zone, target);
  if (target === 'main') return toMain(id);
  const t = front();
  const [a, b] = [t.groups.indexOf(id), t.groups.indexOf(target)];
  [t.groups[a], t.groups[b]] = [target, id];
  keep();
  draw();
}

addEventListener('resize', () => {
  const dir = dirNow();
  if (started && host.dataset.dir !== dir) ((host.dataset.dir = dir), draw());
});
// The sheet opening or shutting changes the room the panes share.
new MutationObserver(() => started && front().groups.length > 1 && draw()).observe(document.body, { attributes: true, attributeFilter: ['data-sheet'] });

/** The query bar's own for the pane it acts on, the same in every pane: back and forth (dimmed with nowhere to go) and split. A docked pane's move, make main and close stay in its strip. */
export function paneButtons() {
  const { back, forth } = historyNow();
  const button = (label, title, mark, onclick, off, cls = 'q-save') => h('button', { type: 'button', class: cls, title, 'aria-label': label, disabled: off, onclick }, mark);
  const entry = active === 'main' ? null : drawn.get(active);
  return [
    button('Back', 'Back to what this pane drew before', '‹', () => travel(-1), !back.length, 'q-save q-travel'),
    button('Forward', 'Forward again', '›', () => travel(1), !forth.length, 'q-save q-travel'),
    button('Split', 'Split: open this canvas in a pane beside it (drag the pane’s name to dock it elsewhere)', ['◫', h('span', { class: 'q-word-text' }, 'Split')], () => openPane(asPane(active === 'main' ? canvasHref() : `#/${entry.at}`), 'right', active), false, 'q-save q-word q-split'),
  ];
}
/** The address the pane the bar acts on draws, for a new tab to open on. */
export const activeAt = () => (active === 'main' ? canvasHref() : `#/${drawn.get(active)?.at ?? ''}`);

/** Light a pane an agent's step was just drawn in. */
export function flash(id) {
  const entry = drawn.get(id);
  if (!entry) return null;
  entry.el.classList.remove('pane-shown');
  void entry.el.offsetWidth;
  entry.el.classList.add('pane-shown');
  return entry.el.querySelector('.pane-canvas');
}

let started = false;
/** Draw the panes of the tab in sight, once the page has read its tabs (ui/tab-bar.js). */
export const startPanes = () => ((started = true), draw());
