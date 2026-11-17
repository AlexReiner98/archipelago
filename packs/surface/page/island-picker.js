// The island picker (decision e_n42s8jvn; Alex, 17 Nov 2026: a side list and a palette, for hundreds of islands): a list
// at the canvas's left edge that folds to it, and a palette over the canvas on Ctrl+K (./island-palette.js). Both read
// one search (./islands-list.js, rankIslands). The side list: a search line, the islands on (each × to take it off),
// then every other island in groups by pack, each folded with its count; a press on one puts it on.

import { api, h } from './base.js';
import { islandsOn, keepList, onIslands } from './islands-on.js';
import { atHome, byPack, drawnAt, only, rankIslands, turnedOn } from './islands-list.js';
import { openPalette } from './island-palette.js';
import { titles } from './words.js';

/** Every island on the map, each with its pack, read once a page. */
let reading;
export const allIslands = () =>
  (reading ??= api('search', { islands: true, limit: 2000 }).then(
    (found) => found.map((e) => (titles.set(e.id, e.title), { id: e.id, title: e.title, pack: e.pack ?? { id: '', title: '' } })),
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

/** A pack's mark: its glyph, else its initial. */
export const packMark = (pack) => h('span', { class: 'isl-mark', 'aria-hidden': 'true' }, pack?.glyph || String(pack?.title || pack?.id || '·').slice(0, 1).toUpperCase());

/** What the side list keeps in this browser: whether it is open, which packs are unfolded. */
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

/** Draw the side list and start the palette, once a page; the foot strip of the find bar is put away. */
export function drawPicker() {
  if (document.getElementById('islands')) return;
  const find = document.getElementById('find');
  if (find) find.hidden = true;
  const input = h('input', { class: 'isl-search', type: 'search', placeholder: 'Islands', 'aria-label': 'Find an island', autocomplete: 'off' });
  const fold = h('button', { type: 'button', class: 'isl-fold' });
  const body = h('div', { class: 'isl-body' });
  const side = h('aside', { id: 'islands', 'aria-label': 'Islands' }, h('div', { class: 'isl-top' }, fold, input), body);
  document.body.append(side);
  const open = (on) => {
    document.body.dataset.islands = on ? 'open' : 'folded';
    fold.textContent = on ? '‹' : '›';
    fold.title = on ? 'Fold the islands to the edge' : 'Show the islands';
    fold.setAttribute('aria-expanded', String(on));
    keep('open', on);
    dispatchEvent(new Event('resize'));
  };
  fold.onclick = () => open(document.body.dataset.islands !== 'open');
  open(kept('open', true));
  const unfolded = new Set(kept('packs', []));

  let islands = [];
  const row = (i, on) =>
    h('div', { class: 'isl-row', role: 'listitem' },
      packMark(i.pack),
      on
        ? h('span', { class: 'isl-name', title: `${i.title} · ${i.pack.title || i.pack.id}` }, i.title)
        : h('button', { type: 'button', class: 'isl-name', title: `${i.title}: put on the canvas`, onclick: () => putOn(i) }, i.title),
      on ? h('button', { type: 'button', class: 'isl-off', title: `Take ${i.title} off the canvas`, 'aria-label': `Take ${i.title} off`, onclick: () => takeOff(i) }, '×') : '');
  const draw = () => {
    const drawn = drawnNow(), q = input.value.trim();
    const found = rankIslands(islands, q);
    const on = found.filter((i) => drawn.includes(i.id)), rest = found.filter((i) => !drawn.includes(i.id));
    const parts = [h('div', { class: 'isl-head' }, `On · ${on.length}`), h('div', { role: 'list' }, ...on.map((i) => row(i, true)))];
    for (const g of byPack(rest)) {
      // Searching opens every group that holds a match; else each as the person left it.
      const shown = Boolean(q) || unfolded.has(g.id);
      const head = h('button', { type: 'button', class: 'isl-group', 'aria-expanded': String(shown), title: `${g.title}: ${g.islands.length} island${g.islands.length === 1 ? '' : 's'}` },
        packMark(g.islands[0]?.pack), h('span', { class: 'isl-name' }, g.title || 'No pack'), h('span', { class: 'isl-count' }, String(g.islands.length)));
      head.onclick = () => (unfolded.has(g.id) ? unfolded.delete(g.id) : unfolded.add(g.id), keep('packs', [...unfolded]), draw());
      parts.push(head, ...(shown ? [h('div', { role: 'list' }, ...g.islands.map((i) => row(i, false)))] : []));
    }
    body.replaceChildren(...parts);
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') return void ((input.value = ''), draw());
    const first = rankIslands(islands, input.value).find((i) => !drawnNow().includes(i.id));
    if (ev.key === 'Enter' && first) (ev.preventDefault(), ev.shiftKey ? showOnly(first) : putOn(first));
  });
  onDrawn(draw);
  openPalette({ all: allIslands, drawn: drawnNow, putOn, showOnly, mark: packMark });
  Promise.all([islandsOn(), allIslands()]).then(([now, all]) => ((mine = now), (islands = all), draw()));
}
