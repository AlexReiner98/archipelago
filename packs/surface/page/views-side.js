// Custom views, the side bar's second row (Alex, 19 Nov 2026: e_spqgn9td, e_74ghhvdp, e_w5afrkr6). The islands are home;
// a view is put up in their place for a while by a press on its row, and its × or a press on Islands brings them back.
// Pinned first, a part of its own: the views on the person's list, kept beside their islands (./islands-on.js, `view:`
// entries). Then All, every other view: those kept on the map and those packs ship (Alex, 19 Nov 2026: all the views in
// a list below, Keep called Pin, the pinned at the top apart).

import { h } from './base.js';
import { canvasAt, savedCanvases } from './views-kept.js';
import { keepViews, onViews, viewsKept } from './islands-on.js';

/** An address with its query's terms in one order, so two that say the same compare equal. */
const norm = (hash) => {
  const [path, q = ''] = String(hash ?? '').replace(/^#/, '').split('?');
  const terms = new URLSearchParams(q);
  terms.sort();
  return `${path}?${terms}`;
};
/** Whether view `v` is the one an address draws: a lens by the id it names, a pack's view by its whole address. */
const drawsAt = (v, hash) => {
  const named = new URLSearchParams(String(hash).split('?')[1] ?? '').get('canvas');
  return named ? named === v.id : Boolean(v.preset) && norm(hash) === norm(canvasAt(v));
};
/** The view a kept id names: a lens by its id, a pack's view by its id or the owner's kept version of it. */
const named = (all, id) => all.find((v) => v.id === id) ?? all.find((v) => v.props?.preset === id);
/** The id a view is kept by: a pack's by the id its pack gives it, so it follows the owner's version of it. */
const keptBy = (v) => v.props?.preset ?? v.id;

/** The view up now, by the id it is kept by: null while the canvas draws the islands or anything else. */
let upId = null;
export const viewUp = () => upId;

/**
 * The row's list: `list` the element it fills, `done` what a press does after it (the bar over the canvas folds),
 * `counted` told how many are kept and whether one is up. Drawn again as the address or the list changes.
 */
export function viewsList(list, { done = () => {}, counted = () => {} } = {}) {
  let all = [], kept = [];
  const draw = () => {
    const up = all.find((v) => drawsAt(v, location.hash)) ?? null;
    upId = up ? keptBy(up) : null;
    const mine = kept.map((id) => named(all, id)).filter(Boolean);
    const shown = new Set(mine.map(keptBy));
    const rest = all.filter((v) => !shown.has(keptBy(v)));
    const said = (err) => console.warn(err.message);
    const row = (v, pinned) => {
      const on = up === v;
      const back = h('button', { type: 'button', class: 'isl-off', tabindex: '-1', title: 'Back to the islands', 'aria-label': 'Back to the islands', onclick: () => ((location.hash = '#/'), done()) }, '×');
      const pin = pinned
        ? h('button', { type: 'button', class: 'isl-pin', tabindex: '-1', title: `Unpin ${v.title}`, onclick: () => keepViews(kept.filter((id) => id !== keptBy(v)), `${v.title} unpinned`).catch(said) }, 'Unpin')
        : h('button', { type: 'button', class: 'isl-pin', tabindex: '-1', title: `Pin ${v.title} at the top`, onclick: () => keepViews([...kept, keptBy(v)], `${v.title} pinned`).catch(said) }, 'Pin');
      return h('div', { class: `isl-row isl-view${on ? ' on' : ''}`, role: 'listitem', 'data-view': v.id, ...(on && { 'aria-current': 'page' }) },
        h('button', { type: 'button', class: 'isl-name', tabindex: '-1', title: on ? `${v.title}: up in place of the islands` : `Put ${v.title} up in place of the islands`, onclick: () => ((location.hash = canvasAt(v)), done()) }, v.title),
        pin, on ? back : '');
    };
    const part = (at, head, views, pinned) => (views.length ? [h('div', { class: `isl-sec isl-sec-${at}` }, h('div', { class: 'isl-head' }, `${head} · ${views.length}`), h('div', { role: 'list' }, ...views.map((v) => row(v, pinned))))] : []);
    list.replaceChildren(...part('pinned', 'Pinned', mine, true), ...part('views', 'All', rest, false));
    counted(mine.length, Boolean(up));
  };
  addEventListener('hashchange', draw);
  onViews((now) => ((kept = now), draw()));
  Promise.all([savedCanvases(), viewsKept()]).then(([a, k]) => ((all = a), (kept = k), draw()));
  // A view kept or made since the list was read (another tab, an agent's): read again as the address names one it lacks.
  addEventListener('hashchange', () => {
    const id = new URLSearchParams(location.hash.split('?')[1] ?? '').get('canvas');
    if (id && !all.some((v) => v.id === id)) savedCanvases(true).then((a) => ((all = a), draw()));
  });
  return draw;
}
