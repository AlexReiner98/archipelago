// The island picker (decision e_n42s8jvn; Alex, 17 Nov 2026: a side list and a palette, for hundreds of islands, all of
// it within the bar): a list at the canvas's left edge that folds to it. A search line (Ctrl+K opens the bar there), the
// islands on (each × to take it off), then those changed lately, the latest first, then every other by name (Alex, 17 Nov
// 2026, e_cr4haav9: no pack groups); a press on one puts it on. Typed into, the bar lists what it finds best first (./islands-list.js, rankIslands): arrows move,
// Enter puts the lit one on, Shift+Enter shows it alone.

import { api, h, hooks, state } from './base.js';
import { islandsOn, keepList, onIslands } from './islands-on.js';
import { atHome, capital, drawnAt, only, packMarks, rankIslands, recentFirst, turnedOn } from './islands-list.js';
import { numberOf } from './style-number.js';
import { titles } from './words.js';

/** Each pack's mark by its id, told apart from the others' (./islands-list.js, packMarks). */
let marks = new Map();
/** Every island on the map, each with its pack, read once a page. */
let reading;
export const allIslands = () =>
  (reading ??= api('search', { islands: true, limit: 2000 }).then(
    (found) => {
      const all = found.map((e) => (titles.set(e.id, e.title), { id: e.id, title: e.title, worked_at: e.worked_at ?? e.updated_at, pack: e.pack ?? { id: '', title: '' } }));
      marks = packMarks(all.map((i) => i.pack));
      return all;
    },
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

/** A pack's mark: its glyph, else two of its letters, unlike every other pack's. */
export const packMark = (pack) => h('span', { class: 'isl-mark', 'aria-hidden': 'true' }, marks.get(pack?.id ?? '') ?? packMarks([pack]).get(pack?.id ?? ''));
/** A pack's title as the list shows it. */
const packTitle = (pack) => capital(pack?.title || pack?.id);

/** What the side list keeps in this browser: whether it is open. */
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
  // The rail along the bar's edge, its whole height a press that folds the bar to the edge or opens it again.
  const arrow = h('span', { class: 'isl-arrow', 'aria-hidden': 'true' });
  const count = h('span', { class: 'isl-rail-count' });
  const fold = h('button', { type: 'button', class: 'isl-rail' }, arrow, count);
  const body = h('div', { class: 'isl-body' });
  // No tooltip on a row: a name cut short has the whole of it as its tooltip, the name alone.
  body.addEventListener('pointerover', (ev) => {
    const name = ev.target.closest?.('.isl-name');
    if (name) name.scrollWidth > name.clientWidth ? (name.title = name.textContent) : name.removeAttribute('title');
  });
  const side = h('aside', { id: 'islands', 'aria-label': 'Islands' }, h('div', { class: 'isl-panel' }, h('div', { class: 'isl-top' }, input), body), fold);
  document.body.append(side);
  /** Whether the bar was folded for an item's page, not by the person: it opens again when the page closes. */
  let forPage = false;
  /** Fold or open the bar; `kept`, as the person left it (a fold for a page is not). */
  const open = (on, kept = true) => {
    if (kept) forPage = false;
    document.body.dataset.islands = on ? 'open' : 'folded';
    arrow.textContent = on ? '‹' : '›';
    fold.title = on ? 'Fold the islands to the edge (Ctrl+K opens them again)' : 'Show the islands (Ctrl+K)';
    fold.setAttribute('aria-label', on ? 'Fold the islands' : 'Show the islands');
    fold.setAttribute('aria-expanded', String(on));
    if (kept) keep('open', on);
    dispatchEvent(new Event('resize'));
  };
  fold.onclick = () => open(document.body.dataset.islands !== 'open');
  open(kept('open', true));
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
  addEventListener('resize', (ev) => ev.isTrusted && requestAnimationFrame(room));
  room();

  let islands = [];
  let found = [];
  let lit = 0;
  /**
   * The islands laid out under On: set when the list is laid out anew (the page opened, a search cleared), not by a
   * press, so a row stays where it stands as it goes on or off and the next press hits what it aims at.
   */
  let laidOn = null;
  /** An island's row: its pack's mark and its name, a press on which puts it on, or, on, brings the canvas to it. */
  const row = (i, on) =>
    h('div', { class: `isl-row${on ? ' on' : ''}`, role: 'listitem' },
      packMark(i.pack),
      h('button', { type: 'button', class: 'isl-name', onclick: () => (on ? hooks.toIsland?.(i.id) : putOn(i)) }, i.title),
      on ? h('button', { type: 'button', class: 'isl-off', title: `Take ${i.title} off the canvas`, 'aria-label': `Take ${i.title} off`, onclick: () => takeOff(i) }, '×') : '');
  /** A row of what the search found: its pack's mark, its name, its pack (and whether it is on), lit as Enter would take it. */
  const hit = (i, n, drawn) =>
    h('div', { class: 'isl-row isl-hit', role: 'option', id: `isl-${i.id}`, 'aria-selected': String(n === lit), onpointerdown: (ev) => ev.preventDefault(), onclick: (ev) => (ev.shiftKey ? showOnly(i) : putOn(i)) },
      packMark(i.pack),
      h('span', { class: 'isl-name' }, i.title),
      h('span', { class: 'isl-count' }, drawn.includes(i.id) ? `on · ${packTitle(i.pack)}` : packTitle(i.pack)));
  const draw = () => {
    const drawn = drawnNow(), q = input.value.trim();
    count.textContent = drawn.length ? String(drawn.length) : '';
    found = rankIslands(islands, q);
    // Searching: one list, best first, worked from the keyboard, within the bar (Alex: nothing drops outside it).
    if (q) {
      lit = Math.min(lit, Math.max(0, found.length - 1));
      body.replaceChildren(h('div', { class: 'isl-head' }, `Found · ${found.length}`), h('div', { role: 'listbox', 'aria-label': 'Islands found' }, ...found.map((i, n) => hit(i, n, drawn))));
      if (found[lit]) input.setAttribute('aria-activedescendant', `isl-${found[lit].id}`);
      body.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    input.removeAttribute('aria-activedescendant');
    laidOn ??= new Set(drawn);
    const on = found.filter((i) => laidOn.has(i.id)), rest = found.filter((i) => !laidOn.has(i.id));
    const parts = [h('div', { class: 'isl-head' }, `On · ${drawn.length}`), h('div', { role: 'list' }, ...on.map((i) => row(i, drawn.includes(i.id))))];
    const { recent, rest: others } = recentFirst(rest, Date.now(), numberOf(state.style, 'picker_recent_days'));
    const list = (head, all) => (all.length ? [h('div', { class: 'isl-head' }, `${head} · ${all.length}`), h('div', { role: 'list' }, ...all.map((i) => row(i, drawn.includes(i.id))))] : []);
    parts.push(...list('Recent', recent), ...list('All', others));
    body.replaceChildren(...parts);
  };
  /** Lay the list out anew: what is on now goes under On. */
  const relay = () => ((laidOn = null), draw());
  /** Lay it out anew once the list a press keeps has come back (a search's Enter: it was found, not pointed at). */
  let anew = false;
  input.addEventListener('input', () => ((lit = 0), relay()));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') return void (ev.preventDefault(), (input.value = ''), relay(), input.blur());
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && found.length) return void (ev.preventDefault(), (lit = Math.max(0, Math.min(found.length - 1, lit + (ev.key === 'ArrowDown' ? 1 : -1)))), draw());
    const i = input.value.trim() && found[lit];
    if (ev.key === 'Enter' && i) (ev.preventDefault(), ev.shiftKey ? showOnly(i) : putOn(i), (input.value = ''), (anew = true), draw());
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
