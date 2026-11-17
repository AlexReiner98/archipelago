// The island picker (decision e_n42s8jvn; Alex, 17 Nov 2026: a side list and a palette, for hundreds of islands, all of
// it within the bar): a list at the canvas's left edge that folds to it. A search line (Ctrl+K opens the bar there), the
// islands on (each × to take it off), then those changed lately, the latest first, then every other by name (Alex, 17 Nov
// 2026, e_cr4haav9: no pack groups); a press on one puts it on. Typed into, the bar lists what it finds best first (./islands-list.js, rankIslands): arrows move,
// Enter puts the lit one on, Shift+Enter shows it alone.

import { api, h, hooks, state } from './base.js';
import { islandsOn, keepList, onIslands } from './islands-on.js';
import { atHome, capital, drawnAt, only, rankIslands, recentFirst, turnedOn } from './islands-list.js';
import { numberOf } from './style-number.js';
import { titles } from './words.js';

/** Every island on the map, each with its pack, read once a page. */
let reading;
export const allIslands = () =>
  (reading ??= api('search', { islands: true, limit: 2000 }).then(
    (found) => found.map((e) => (titles.set(e.id, e.title), { id: e.id, title: e.title, worked_at: e.worked_at ?? e.updated_at, pack: e.pack ?? { id: '', title: '' } })),
    () => [],
  ));

let mine = [];
const heard = new Set();
/** The islands the canvas draws now: the address's, else the person's own. */
export const drawnNow = () => drawnAt(location.hash, mine);
/** Hear what the canvas draws change (a toggle, the address). */
export const onDrawn = (f) => heard.add(f);
const tell = () => heard.forEach((f) => f());
onIslands((now) => ((mine = now), tell()));
addEventListener('hashchange', tell);

/** Keep what a press makes of the list, and bring the canvas Home where it drew another list. */
function apply({ list, home }, reason) {
  keepList(list, reason).catch((err) => console.warn(err.message));
  if (home) location.hash = '#/';
}
/** Put island `i` on. */
export const putOn = (i) => apply(turnedOn(location.hash, mine, i.id), `${i.title} put on the canvas`);
/** Take island `i` off. */
export const takeOff = (i) => apply({ list: drawnNow().filter((x) => x !== i.id), home: !atHome(location.hash) }, `${i.title} taken off the canvas`);
/** Island `i` alone on the canvas. */
export const showOnly = (i) => apply(only(location.hash, i.id), `${i.title} alone on the canvas`);

/** A pack's title as the list shows it. */
const packTitle = (pack) => capital(pack?.title || pack?.id);
/**
 * Island `i`'s pack, at its row's right in muted text, cut short where it does not fit: what tells like names apart.
 * None where the pack has the island's own name.
 */
const packOf = (i, on = false) => {
  const pack = packTitle(i.pack), same = pack.toLowerCase() === String(i.title).toLowerCase();
  if (same && !on) return '';
  return h('span', { class: 'isl-pack' }, on ? (same ? 'on' : `on · ${pack}`) : pack);
};

/** What the side list keeps in this browser: whether it is open, and its width. */
const KEPT = 'pelago-islands-side';
const kept = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(`${KEPT}:${key}`) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const keep = (key, v) => {
  try {
    localStorage.setItem(`${KEPT}:${key}`, JSON.stringify(v));
  } catch {
    // Without storage, the list opens as it opens by default.
  }
};

/** Draw the side list, once a page; the foot strip of the find bar is put away. */
export function drawPicker() {
  if (document.getElementById('islands')) return;
  const find = document.getElementById('find');
  if (find) find.hidden = true;
  const input = h('input', { class: 'isl-search', type: 'search', placeholder: 'Islands', 'aria-label': 'Find an island', title: 'Enter puts the lit island on, Shift+Enter shows it alone', autocomplete: 'off' });
  // Its shortcut, at the line's right while nothing is typed.
  const key = h('span', { class: 'isl-key', 'aria-hidden': 'true' }, /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K');
  // The rail along the bar's edge, its whole height a press that folds the bar to the edge or opens it again.
  const arrow = h('span', { class: 'isl-arrow', 'aria-hidden': 'true' });
  const count = h('span', { class: 'isl-rail-count' });
  const fold = h('button', { type: 'button', class: 'isl-rail' }, arrow, count);
  // The list is one stop for Tab, worked with arrows (see `keys` below); its rows' presses are for the pointer.
  const body = h('div', { class: 'isl-body', tabindex: '0', 'aria-label': 'Islands' });
  // No tooltip on a row: a name cut short has the whole of it as its tooltip, the name alone.
  body.addEventListener('pointerover', (ev) => {
    const name = ev.target.closest?.('.isl-name');
    if (name) name.scrollWidth > name.clientWidth ? (name.title = name.textContent) : name.removeAttribute('title');
  });
  const side = h('aside', { id: 'islands', 'aria-label': 'Islands' }, h('div', { class: 'isl-panel' }, h('div', { class: 'isl-top' }, input, key), body), fold);
  document.body.append(side);
  /** Whether the bar was folded for an item's page, not by the person: it opens again when the page closes. */
  let forPage = false;
  /** Fold or open the bar; `kept`, as the person left it (a fold for a page is not). */
  const open = (on, kept = true) => {
    if (kept) forPage = false;
    document.body.dataset.islands = on ? 'open' : 'folded';
    arrow.textContent = on ? '‹' : '›';
    fold.title = on ? 'Fold the islands to the edge (Ctrl+K opens them again); drag to widen' : 'Show the islands (Ctrl+K)';
    fold.setAttribute('aria-label', on ? 'Fold the islands' : 'Show the islands');
    fold.setAttribute('aria-expanded', String(on));
    if (kept) keep('open', on);
    dispatchEvent(new Event('resize'));
  };
  fold.onclick = () => (dragged ? (dragged = false) : open(document.body.dataset.islands !== 'open'));
  // Dragged, the rail sets the open bar's width, between the style's picker_width_least and _most, kept in this
  // browser; a double-click gives the default back.
  let dragged = false;
  const widen = (w) => {
    if (w === null) document.body.style.removeProperty('--isl-width');
    else document.body.style.setProperty('--isl-width', `${Math.round(Math.max(numberOf(state.style, 'picker_width_least'), Math.min(numberOf(state.style, 'picker_width_most'), w)))}px`);
    dispatchEvent(new Event('resize'));
  };
  const keptWidth = kept('width', null);
  if (typeof keptWidth === 'number') widen(keptWidth);
  fold.addEventListener('pointerdown', (down) => {
    if (document.body.dataset.islands !== 'open') return;
    const from = down.clientX, start = side.getBoundingClientRect().width, least = numberOf(state.style, 'picker_drag_from');
    const move = (ev) => {
      if (!dragged && Math.abs(ev.clientX - from) < least) return;
      dragged = true;
      widen(start + ev.clientX - from);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (dragged) keep('width', side.getBoundingClientRect().width);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
  fold.addEventListener('dblclick', () => (widen(null), keep('width', null), open(true)));
  // A narrow window (below the style's picker_over_below) has no room for the bar beside the canvas: the bar starts
  // folded, and opened it lies over the canvas until an island is pressed or the canvas is.
  const narrow = () => innerWidth < numberOf(state.style, 'picker_over_below');
  const over = () => (document.body.dataset.islandsOver = narrow() ? 'on' : '');
  over();
  if (narrow()) open(false, false);
  else open(kept('open', true));
  /** Over the canvas, the bar folds away once a press has done what it was opened for. */
  const done = () => document.body.dataset.islandsOver === 'on' && document.body.dataset.islands === 'open' && open(false, false);
  document.getElementById('canvas')?.addEventListener('pointerdown', done);
  // An item's page takes the right: where the canvas left between it and the open bar would be narrower than the bar,
  // the bar folds to its rail, and opens again as it was once the page is shut or the window has the room.
  let wide = side.offsetWidth;
  const room = () => {
    const shown = document.body.dataset.islands === 'open';
    if (shown) wide = side.offsetWidth || wide;
    const page = document.body.dataset.sheet === 'open' ? (document.getElementById('sheet')?.offsetWidth ?? 0) : 0;
    const cramped = page > 0 && innerWidth - page - wide < wide;
    if (shown && cramped) open(false, false), (forPage = true);
    else if (forPage && !cramped) (forPage = false), open(true, false);
  };
  new MutationObserver(room).observe(document.body, { attributes: true, attributeFilter: ['data-sheet'] });
  // The window's own resizes, not the one a fold sends: a bar the person opened over a page stays open.
  addEventListener('resize', (ev) => ev.isTrusted && requestAnimationFrame(() => (over(), room())));
  room();

  let islands = [];
  let found = [];
  let lit = 0;
  /**
   * The islands laid out under On: set when the list is laid out anew (the page opened, a search cleared), not by a
   * press, so a row stays where it stands as it goes on or off and the next press hits what it aims at.
   */
  let laidOn = null;
  /** The island the canvas was last brought to from the bar: marked under On while it stays on. */
  let here = null;
  /** Bring the canvas to island `i`, where the canvas can (hooks.toIsland, the canvas's), and mark it. */
  const goTo = (i) => hooks.toIsland?.(i.id) && ((here = i.id), draw(), true);
  /**
   * Put island `i` on (or `alone`) and bring the canvas to it once the canvas has drawn it: asked again every
   * picker_go_every ms, picker_go_tries times at most, as the canvas draws the new list.
   */
  const putOnAndGo = (i, alone = false) => {
    (alone ? showOnly : putOn)(i);
    let tries = numberOf(state.style, 'picker_go_tries');
    const go = () => goTo(i) || (--tries > 0 && setTimeout(go, numberOf(state.style, 'picker_go_every')));
    if (hooks.toIsland) setTimeout(go, numberOf(state.style, 'picker_go_every'));
  };
  /** A found island taken: one that is on is gone to (with Shift, shown alone); one that is off is put on and gone to. */
  const press = (i, alone = false) => (drawnNow().includes(i.id) && !alone ? goTo(i) : putOnAndGo(i, alone));
  /**
   * An island's row: its name, a press on which puts it on, or, on, brings the canvas to it; then its pack, but under On
   * (`atOn`), where the name needs the room beside ×.
   */
  const row = (i, on, atOn = false) =>
    h('div', { class: `isl-row${on ? ' on' : ''}`, role: 'listitem', 'data-id': i.id, ...(on && i.id === here && { 'aria-current': 'location' }) },
      h('button', { type: 'button', class: 'isl-name', tabindex: '-1', onclick: () => (on ? goTo(i) : putOnAndGo(i), done()) }, i.title),
      atOn ? '' : packOf(i),
      on ? h('button', { type: 'button', class: 'isl-off', tabindex: '-1', title: `Take ${i.title} off the canvas`, 'aria-label': `Take ${i.title} off`, onclick: () => takeOff(i) }, '×') : '');
  /** A row of what the search found: its name, its pack (and whether it is on), lit as Enter would take it; one on reads as on. */
  const hit = (i, n, drawn) =>
    h('div', { class: `isl-row isl-hit${drawn.includes(i.id) ? ' on' : ''}`, role: 'option', id: `isl-${i.id}`, 'aria-selected': String(n === lit), onpointerdown: (ev) => ev.preventDefault(), onclick: (ev) => (press(i, ev.shiftKey), done()) },
      h('span', { class: 'isl-name' }, i.title),
      packOf(i, drawn.includes(i.id)));
  const draw = () => {
    const drawn = drawnNow(), q = input.value.trim();
    count.textContent = drawn.length ? String(drawn.length) : '';
    found = rankIslands(islands, q);
    // Searching: one list, best first, worked from the keyboard, within the bar (Alex: nothing drops outside it).
    if (q) {
      lit = Math.min(lit, Math.max(0, found.length - 1));
      const none = found.length ? [] : [h('div', { class: 'isl-row isl-none' }, `Nothing named “${q}”`)];
      body.replaceChildren(h('div', { class: 'isl-head' }, `Found · ${found.length}`), ...none, h('div', { role: 'listbox', 'aria-label': 'Islands found' }, ...found.map((i, n) => hit(i, n, drawn))));
      if (found[lit]) input.setAttribute('aria-activedescendant', `isl-${found[lit].id}`);
      body.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    input.removeAttribute('aria-activedescendant');
    laidOn ??= new Set(drawn);
    const on = found.filter((i) => laidOn.has(i.id)), rest = found.filter((i) => !laidOn.has(i.id));
    const parts = [h('div', { class: 'isl-head' }, `On · ${drawn.length}`), h('div', { role: 'list' }, ...on.map((i) => row(i, drawn.includes(i.id), true)))];
    const { recent, rest: others } = recentFirst(rest, Date.now(), numberOf(state.style, 'picker_recent_days'), numberOf(state.style, 'picker_recent_most'));
    const list = (head, all) => (all.length ? [h('div', { class: 'isl-head' }, `${head} · ${all.length}`), h('div', { role: 'list' }, ...all.map((i) => row(i, drawn.includes(i.id))))] : []);
    parts.push(...list('Recent', recent), ...list('All', others));
    body.replaceChildren(...parts);
    light();
  };
  /** The row the keyboard is on in the list (an island's id), lit while the list has the focus. */
  let cur = null;
  const rowsNow = () => [...body.querySelectorAll('.isl-row[data-id]')];
  const light = () => {
    const rows = rowsNow(), focused = document.activeElement === body;
    if (focused && !rows.some((r) => r.dataset.id === cur)) cur = rows[0]?.dataset.id ?? null;
    for (const r of rows) r.toggleAttribute('data-lit', focused && r.dataset.id === cur);
    body.querySelector('[data-lit]')?.scrollIntoView({ block: 'nearest' });
  };
  body.addEventListener('focus', light);
  body.addEventListener('blur', light);
  // Arrows move the lit row, Enter presses its name (puts it on, or goes to it), Delete takes it off; up from the top,
  // or Escape, goes back to the search line.
  body.addEventListener('keydown', (ev) => {
    const rows = rowsNow(), at = rows.findIndex((r) => r.dataset.id === cur), row = rows[at];
    const to = (n) => ((cur = rows[Math.max(0, Math.min(rows.length - 1, n))]?.dataset.id ?? cur), light());
    if (ev.key === 'ArrowDown') to(at + 1);
    else if (ev.key === 'ArrowUp') at <= 0 ? input.focus() : to(at - 1);
    else if (ev.key === 'Home') to(0);
    else if (ev.key === 'End') to(rows.length - 1);
    else if (ev.key === 'Enter') row?.querySelector('.isl-name')?.click();
    else if (ev.key === 'Delete' || ev.key === 'Backspace') row?.querySelector('.isl-off')?.click();
    else if (ev.key === 'Escape') input.focus();
    else return;
    ev.preventDefault();
  });
  /** Lay the list out anew: what is on now goes under On. */
  const relay = () => ((laidOn = null), draw());
  // Rows stay put while the pointer is in the bar, so the next press lands; once it leaves, what was taken off leaves
  // On and what was put on joins it.
  side.addEventListener('pointerleave', () => {
    if (input.value.trim() || !laidOn) return;
    const drawn = drawnNow();
    if (drawn.length !== laidOn.size || drawn.some((id) => !laidOn.has(id))) relay();
  });
  /** Lay it out anew once the list a press keeps has come back (a search's Enter: it was found, not pointed at). */
  let anew = false;
  input.addEventListener('input', () => ((lit = 0), relay()));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') return void (ev.preventDefault(), (input.value = ''), relay(), input.blur());
    if (ev.key === 'ArrowDown' && !input.value.trim()) return void (ev.preventDefault(), body.focus());
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && found.length) return void (ev.preventDefault(), (lit = Math.max(0, Math.min(found.length - 1, lit + (ev.key === 'ArrowDown' ? 1 : -1)))), draw());
    const i = input.value.trim() && found[lit];
    if (ev.key === 'Enter' && i) (ev.preventDefault(), press(i, ev.shiftKey), (input.value = ''), (anew = true), draw(), done());
  });
  // Ctrl+K (⌘K): the bar opens where it was folded, its search in focus.
  addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.key.toLowerCase() !== 'k') return;
    ev.preventDefault();
    if (document.body.dataset.islands !== 'open') open(true);
    input.focus();
    input.select();
  });
  onDrawn(() => (anew ? ((anew = false), relay()) : draw()));
  Promise.all([islandsOn(), allIslands()]).then(([now, all]) => ((mine = now), (islands = all), draw()));
}
