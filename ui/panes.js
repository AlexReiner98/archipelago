// Panes: the canvases in sight at once in a tab (ui/tab-bar.js), docked side by side as a code editor's groups are;
// they stay together in their tab (decision e_mzer5m4t). Every pane is the same: a canvas of its own (ui/canvas.js)
// drawing the address it was given (a lens, a saved canvas, an item), held in its own store and kept current from the
// log (ui/live.js), with its own back and forward, a step for each lens it was given, not for a page opened over it
// (e_ssnyd3ex), kept with its tab so a reload draws it as it was. The query bar and find act on the pane last touched
// (decision e_h2pqjy2q), and the address is that pane's (ui/pane-address.js). Only the tab in sight is drawn; the
// others keep where their panes stand (ui/tabs.js). An agent arranges them with report show and its `pane`; where a
// step lands is ui/pane-route.js.

import { api, h, hooks, state } from './base.js';
import { activate, canvasIn, focusOn } from './canvas.js';
import { canvasLens } from './canvases.js';
import { flatQuery, readFlatLens } from './lens.js';
import { numberOf } from './lens-base.js';
import { dragPane, sashes } from './pane-drag.js';
import { nameOf } from './pane-route.js';
import { filterSaid } from './query-bar.js';
import { asPane, drawable, focusOf, freshPane, front, hrefOf, keep, named, newId } from './tabs.js';
import { titles } from './words.js';

/** The sides a pane is docked on, beside the pane it is put by: along a row, or down a column. */
const SIDES = { left: ['row', 0], right: ['row', 1], above: ['column', 0], below: ['column', 1] };
/** The most steps a pane keeps back and forth: the style's. */
const kept = () => numberOf(state.style, 'pane_steps_kept');

// ---- The layout of the tab in sight: its panes in one row or one column, each its share.

const even = (t = front()) => (t.sizes = t.groups.map(() => 1 / t.groups.length));
/** Along a row on a page wider than tall; a row on a page taller than wide is drawn as a column. */
const dirNow = () => (front().dir === 'row' && innerWidth < innerHeight ? 'column' : front().dir);

// ---- What a pane draws: the address it was given (as an agent's show names a place: `v?…`, `e/<id>`).

/** The lens and style a pane's address names (no lens for Home): a saved canvas named alone is read from the map. */
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
  return id ? { lens: focusOn(id), style: {}, here: id } : { lens: null, style: {} };
}
/** A pane's address for an address of the page: an item's page draws the lens beside it, else the item's own canvas. */
export function paneAt(at) {
  const bare = asPane(at);
  const [where, query = ''] = bare.split('?');
  const item = /^e\/(e_[a-z0-9]{8})$/.exec(where)?.[1];
  if (!item) return bare;
  return `v?${readFlatLens(query).lens ? query : flatQuery(focusOn(item), {})}`;
}

/** The panes drawn now, by id: { el, body, name, mark, canvas, at, here }. */
export const drawn = new Map();

function paneEl(id) {
  const name = h('span', { class: 'pane-name', title: 'Drag to dock it elsewhere' }, 'Canvas');
  const mark = h('span', { class: 'pane-follows', hidden: true });
  const body = h('div', { class: 'pane-canvas' });
  const button = (title, mark, onclick) => h('button', { type: 'button', class: 'pane-act', title, 'aria-label': title, onclick }, mark);
  // Its controls stand in its strip in focus or not: in focus, the query bar takes the name's place between them.
  const grip = h('span', { class: 'pane-act pane-grip', title: 'Drag to dock it elsewhere', 'aria-label': 'Move this pane' }, '⠿');
  const el = h('section', { class: 'pane', 'data-pane': id }, h('header', { class: 'pane-bar' }, grip, name, mark, button('Close this pane', '×', () => close(id))), body);
  for (const handle of [grip, name]) handle.addEventListener('pointerdown', (ev) => dragPane(ev, id, el, { groups: groupEls, drop }));
  const canvas = canvasIn(body, {
    go: (lens) => goPane(id, lens ? `v?${flatQuery(lens, canvas.asked)}` : 'v'),
    open: (href) => goPane(id, paneAt(href)),
    // A click on an item: this pane is the one in focus, its lens as it was, the item's page open over it.
    opened: (item, lens) => {
      activeIs(id);
      location.hash = `#/e/${item}?${flatQuery(lens, canvas.asked)}`;
    },
  });
  const entry = { el, body, name, mark, canvas, at: null, here: undefined };
  drawn.set(id, entry);
  load(id, front().panes[id].at);
  return el;
}

/** Draw this address in pane `id`, in place of what it drew: the pane, its name and its history stay. */
function load(id, at) {
  const entry = drawn.get(id);
  entry.at = at;
  lensOf(at)
    .then(({ lens, style, here }) => {
      if (drawn.get(id) !== entry || entry.at !== at) return;
      // Named as its tab would be: a saved canvas by its name, else by what its filter finds.
      const naming = () => {
        entry.name.textContent = (style.canvas && titles.get(style.canvas)) || (lens ? filterSaid(lens.filter, naming) : 'Home') || 'Canvas';
        entry.name.title = `${entry.name.textContent}: drag to dock it elsewhere`;
      };
      naming();
      entry.canvas.show(lens, entry.here ?? here, style);
      if (active === id) activeIs(id);
    })
    .catch((err) => entry.body.replaceChildren(h('div', { class: 'error' }, err.message)));
}

/**
 * Give pane `id` of the tab in sight another address: a step in its history, unless it is one taken back or forth. In
 * focus, the address follows: a step of the browser's for a step (`push`), else written over (`replace`).
 */
export function goPane(id, at, step = true, push = step) {
  const p = front().panes[id];
  if (!p || at === p.at) return;
  if (step) ((p.back = [...(p.back ?? []), p.at].slice(-kept())), (p.forth = []));
  p.at = at;
  keep();
  draw();
  hooks.paneMoved?.();
  if (id === active) say(push, step ? location.hash : '');
}
/** Back (-1) or forth (1) in the history of the pane the bar acts on; whether it moved. The address follows, `from` the page it keeps open. */
export function travel(by, from = '') {
  const p = front().panes[active];
  const [there, here] = by < 0 ? ['back', 'forth'] : ['forth', 'back'];
  if (!p?.[there]?.length) return false;
  const next = p[there].pop();
  p[here] = [...(p[here] ?? []), p.at].slice(-kept());
  p.at = next;
  keep();
  draw();
  hooks.paneMoved?.();
  say(false, from);
  return true;
}

// ---- The address: the pane in focus's, under the page open over it. A step there is a step of the browser's; a move
// of focus or a step back or forth only rewrites it.

/** The address the pane in focus stands at, keeping the page open in `from`: an item's page over its lens, or another page. */
export function hrefNow(from = '') {
  const at = front().panes[active]?.at;
  const base = hrefOf(at);
  const open = /^#\/e\/(e_[a-z0-9]{8})/.exec(from)?.[1];
  const query = base.split('?')[1];
  // An item's page over its own canvas is its bare address, as it is linked to.
  if (open) return at === paneAt(`e/${open}`) || !query ? `#/e/${open}` : `#/e/${open}?${query}`;
  return /^#\/(s|workspace|you|new)\b/.test(from) ? from : base;
}
function say(push, from) {
  if (!started) return;
  const href = hrefNow(from);
  if (location.hash === href || (!location.hash && href === '#/')) return;
  if (push) location.hash = href;
  else history.replaceState(history.state, '', href);
}
/** The page's address given to the pane in focus (ui/app.js): a step there, unless it draws it already; `here` lit in it. */
export function toAddress(at, here) {
  const entry = drawn.get(active);
  if (entry) entry.here = here;
  // The browser took the step already: the address is only written over, to say the lens beside the page.
  if (at !== undefined) goPane(active, paneAt(at), true, false);
  entry?.canvas.mark(here);
}
/** Whether a pane of the tab in sight draws this item now. */
export const drawsIt = (id) => drawn.get(active)?.canvas.has(id);

// ---- The pane the bar acts on: the one last touched. A press in a pane, or the focus going into a style's frame
// there (a frame keeps its presses to itself), makes it the one.

let active = null;
/** The pane the bar acts on, in the tab in sight. */
export const activeId = () => active;
/** The tab and pane the bar last acted on: when it moves to another, the bar and find start afresh there. */
let focused = '';
export function activeIs(id) {
  const t = front();
  if (!t.groups.includes(id)) id = focusOf(t);
  const moved = active !== id;
  active = id;
  // Each tab keeps the pane last touched in it, for when it is brought into sight again (decision e_x9b9yv5g, asked).
  if (t.focus !== id) ((t.focus = id), keep());
  if (focused !== `${t.id}:${id}`) ((focused = `${t.id}:${id}`), dispatchEvent(new Event('pane-focus')));
  frameActive();
  const e = drawn.get(id);
  if (e) activate(e.canvas);
  if (moved) say(false, location.hash);
}
const touched = (target) => {
  const id = target?.closest?.('#canvas > .pane')?.dataset.pane;
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
  for (const [g, e] of drawn) e.el.classList.toggle('pane-active', g === active);
  const box = frames.find(([g]) => g === active)?.[1] ?? frames[0]?.[1];
  for (const side of ['left', 'right', 'top', 'bottom']) document.body.style.setProperty(`--active-${side}`, edge(side, box?.[side] ?? 0));
  markPanes();
}
/** A pane named by a session, or held for one, says whose it is in its strip, and in the tooltip what its session last said of it. */
export function markPanes() {
  for (const [g, e] of drawn) {
    const p = front().panes[g];
    e.mark.textContent = p?.slot ?? (p?.held ? nameOf(p.held) : '');
    e.mark.hidden = !e.mark.textContent;
    e.mark.title = p?.said ?? '';
  }
}

/** The history of the pane the bar acts on. */
const historyNow = () => front().panes[active] ?? freshPane('#/');

// ---- Drawing the tab in sight: each pane put in its frame by its share.

const host = document.getElementById('canvas');
const groupEls = () => front().groups.map((g) => [g, drawn.get(g)?.el]).filter(([, el]) => el);

export function draw() {
  const layout = front();
  for (const [id, entry] of drawn) if (!layout.groups.includes(id)) (entry.canvas.close(), entry.el.remove(), drawn.delete(id));
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
    const el = drawn.get(g)?.el ?? paneEl(g);
    for (const side of ['left', 'right', 'top', 'bottom']) el.style[side] = layout.groups.length > 1 ? edge(side, box[side]) : '';
    if (el.parentNode !== host) host.append(el);
  }
  // In the order they stand, so a reader's tab order and a test's first pane are the leftmost; moved only when out of
  // order, since an element moved loses the pointer a drag of its name holds.
  const order = layout.groups.map((g) => drawn.get(g).el);
  const standing = [...host.children].filter((el) => el.classList.contains('pane'));
  if (order.some((el, n) => standing[n] !== el)) for (const el of order) host.append(el);
  document.body.dataset.panes = String(layout.groups.length);
  if (!layout.groups.includes(active)) activeIs(focusOf(layout));
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

// ---- What can be done with a pane, any pane: open, move, close; an agent's alone keeps only its own.

/**
 * Open this address in a pane on this side of the pane `by` (the one in focus, unless named) in tab `t` (the one in
 * sight unless named); one already on it is moved there. A pane opened for a session by the name it gave (`slot`), or
 * held for it (`held`), is its own, never one already open; so is one opened `anew` (Split: a second of what is up).
 * Answers the pane's id.
 */
export function openPane(at, side = 'right', by = undefined, { anew = false, ...own } = {}, t = front()) {
  if (!drawable(at)) return null;
  at = paneAt(at);
  const same = !anew && !own.slot && !own.held && Object.entries(t.panes).find(([id, p]) => t.groups.includes(id) && !p.slot && !p.held && named(p.at) === named(at));
  const id = same?.[0] ?? newId('p');
  t.panes[id] = { ...freshPane(at), ...t.panes[id], at, ...own };
  place(id, side, by ?? focusOf(t), t);
  return id;
}
/** Put pane `id` on this side of pane `by` in tab `t`: a side across the tab's direction turns it. */
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
/** Close pane `id` of the tab in sight; the last one stays. */
export function close(id) {
  const t = front();
  if (t.groups.length < 2 || !t.groups.includes(id)) return;
  const n = t.groups.indexOf(id);
  t.groups = t.groups.filter((g) => g !== id);
  delete t.panes[id];
  if (t.focus === id) t.focus = t.groups[Math.max(0, n - 1)];
  even();
  keep();
  draw();
}
/** Only pane `id` in tab `t` (the one in sight unless named), the others closed. */
export function only(id, t = front()) {
  if (!t.groups.includes(id)) return;
  Object.assign(t, { dir: 'row', groups: [id], sizes: [1], panes: { [id]: t.panes[id] }, focus: id });
  keep();
  if (t === front()) draw();
}
/** Let go of a pane dragged (ui/pane-drag.js): on a side of another, docked there; in the middle of one, the two swap places. A pane stays in its tab: a tab, not a pane, pops out. */
function drop(id, target, zone) {
  if (zone === 'out') return;
  if (zone !== 'center') return place(id, zone, target);
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

/** The query bar's own for the pane it acts on, the same in every pane: back and forth (dimmed with nowhere to go) and split. Each pane's move and close stay in its strip. */
export function paneButtons() {
  const { back = [], forth = [] } = historyNow();
  const button = (label, title, mark, onclick, off, cls = 'q-save') => h('button', { type: 'button', class: cls, title, 'aria-label': label, disabled: off, onclick }, mark);
  return [
    button('Back', 'Back to what this pane drew before', '‹', () => travel(-1), !back.length, 'q-save q-travel'),
    button('Forward', 'Forward again', '›', () => travel(1), !forth.length, 'q-save q-travel'),
    button('Split', 'Split: open this canvas in a pane beside it (drag the pane’s name to dock it elsewhere)', ['◫', h('span', { class: 'q-word-text' }, 'Split')], () => openPane(historyNow().at, 'right', active, { anew: true }), false, 'q-save q-word q-split'),
  ];
}
/** The address the pane the bar acts on draws, for a new tab to open on. */
export const activeAt = () => hrefOf(front().panes[active]?.at);

/** Light a pane an agent's step was just drawn in. */
export function flash(id) {
  const entry = drawn.get(id);
  if (!entry) return;
  entry.el.classList.remove('pane-shown');
  void entry.el.offsetWidth;
  entry.el.classList.add('pane-shown');
}

let started = false;
/** Draw the panes of the tab in sight, once the page has read its tabs (ui/tab-bar.js). */
export function startPanes() {
  started = true;
  active = focusOf(front());
  draw();
  activeIs(active);
}
