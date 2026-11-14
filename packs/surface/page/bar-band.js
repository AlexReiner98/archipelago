// The bar over the canvas (the `bar` frame slot, decision e_sdsaxxq4): the view's band at the top, joined to its tab or
// its pane's strip, holding what the saved canvas up leads with (ui/canvases.js). Find's line and its rows are the bar
// pack's parts (`bar.find`, `bar.find.rows`, mounted by canvas.js); what stays here is the frame: the band, how it
// narrows as the canvas's name shrinks, and the safe zone it leaves the pane under it (the owner, 28 Oct 2026).
//
// Beside it, by name (hooks), what the page's own modules ask of the bar: a lens in a few words with the page's names
// (`hooks.lensSaid`: a tab's name, a pane's, the band's), the band fitted again (`hooks.fitBar`), and the items a part's
// mark lights (`hooks.lights`, on the view the bar is over).

import { api, firstDrawn, h, hooks } from './base.js';
import { filterSaid, namer } from './query-base.js';
import { lightItems } from './light-items.js';
import { relations, titles, types } from './words.js';

const bar = document.getElementById('query');
/** The view the bar is over, as drawBand was last told. */
let up = null;

/** Draw the band for this lens over this view: `lead` is what the saved canvas up leads with (ui/canvases.js). */
export function drawBand(lens, view, lead) {
  up = view;
  if (!bar) return;
  bar.replaceChildren(h('div', { class: 'q-view', role: 'group', 'aria-label': 'The view' }, lead ?? ''));
  // A lens that names a view has no terms, and its band still says which canvas it is; a blank one (a new tab's, a
  // split's) keeps its band too, for the pane's buttons and its canvas.
  bar.hidden = !(lens?.filter?.find?.length > 0) && !lens?.view && !lead;
  fitBar();
}

/** The view the bar is over: what find reads its answer from. */
export const viewUp = () => up;

/**
 * Fit the band to its width: it drops its buttons' words, then back and forward, then Split as the canvas's name
 * shrinks. Drawn again as the width changes; the pane under it keeps clear of it.
 */
export function fitBar() {
  if (!bar) return;
  const over = (el) => el && el.scrollWidth > el.clientWidth + 1;
  const view = bar.querySelector('.q-view');
  // The band is narrowed by more than the bar: the strip of the pane it stands in takes room beside it.
  if (view) {
    fits.observe(view);
    view.classList.remove('tight', 'tighter', 'tightest');
    const canvas = view.querySelector('.q-canvas');
    for (const step of ['tight', 'tighter', 'tightest']) if (over(view) || over(canvas)) view.classList.add(step);
  }
  keepClear();
}

/** The pane the bar acts on keeps what it draws below the band: its top safe zone is where the bar ends over it. */
function keepClear() {
  const under = document.querySelector('#canvas > .pane.pane-active > .pane-canvas');
  for (const c of document.querySelectorAll('#canvas > .pane > .pane-canvas')) if (c !== under) c.style.removeProperty('--safe-top');
  if (!under || !bar || bar.hidden) return under?.style.removeProperty('--safe-top');
  const below = Math.max(0, Math.round(bar.getBoundingClientRect().bottom - under.getBoundingClientRect().top));
  under.style.setProperty('--safe-top', `calc(${below}px + var(--space-4))`);
}
const fits = new ResizeObserver(() => fitBar());
if (bar) fits.observe(bar);
addEventListener('pane-focus', () => setTimeout(keepClear, 0));
addEventListener('resize', keepClear);

/**
 * Items whose names are being asked, each once, with what waits to be drawn again when the name comes; names come one
 * at a time, so what waits on them is drawn once a frame, however many came in it.
 */
const asking = new Map();
const due = new Set();
let dueAt = 0;
function drawSoon(draws) {
  for (const draw of draws) due.add(draw);
  dueAt ||= requestAnimationFrame(() => {
    dueAt = 0;
    const now = [...due];
    due.clear();
    for (const draw of now) draw();
  });
}
/** Ask an item's name once (once more if the first answer does not come), drawing `redraw` again when it comes. */
function askName(id, redraw) {
  if (asking.has(id)) return void (redraw && asking.get(id).add(redraw));
  asking.set(id, new Set(redraw ? [redraw] : []));
  const ask = (again) =>
    firstDrawn
      .then(() => api('get', { id }))
      .then((got) => {
        titles.set(id, got.entity.title);
        drawSoon(asking.get(id) ?? []);
        asking.set(id, new Set());
      })
      .catch(() => again && ask(false));
  ask(true);
}

/** The schema's words as the lens algebra reads them (packs/walls/page/lens-terms.js). */
const schemaWords = () => ({
  types: Object.fromEntries([...types.entries()].map(([id, t]) => [id, { title: t.title ?? id }])),
  links: Object.fromEntries([...relations.entries()].map(([id, r]) => [id, r.title ?? id])),
});

/**
 * What a filter finds, in a few words, by the names the page knows: an item it does not know yet is asked for, and
 * `redraw` is called once its name has come.
 */
export function lensSaid(filter, redraw) {
  /** The page's names, asking for one it does not know yet. */
  class Named extends Map {
    get(id) {
      if (titles.has(id)) return titles.get(id);
      askName(id, redraw);
      return '…';
    }
  }
  return filterSaid(filter ?? {}, namer(schemaWords(), new Named()).termSaid);
}

hooks.lensSaid = lensSaid;
hooks.fitBar = fitBar;
hooks.lights = (ids) => lightItems(up, ids?.length ? ids : null);
