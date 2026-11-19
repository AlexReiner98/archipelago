// Custom views, the side bar's second row (Alex, 19 Nov 2026: e_spqgn9td, e_74ghhvdp, e_w5afrkr6). The islands are home;
// a view that is a whole drawing (a pack's layout, the Reflex tree) is put up in their place for a while by a press on
// its row, and its × or a press on Islands brings them back. The row lists the views on the person's list, kept beside
// their islands (./islands-on.js, `view:` entries); below them the views packs ship, ready to keep, and the view up
// when it is not kept (an agent's working view), with Keep. Agents' other views stay off until kept.

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
/** A pack's view, kept by the owner or not: what the row offers to keep. */
const packs = (v) => Boolean(v.preset || v.props?.preset);
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
    // Offered: what packs ship, then the view up where it is not kept; never an agent's view that is not up.
    const offered = [...all.filter((v) => packs(v) && !shown.has(keptBy(v))), ...(up && !shown.has(keptBy(up)) && !packs(up) ? [up] : [])];
    const row = (v, isKept) => {
      const on = up === v;
      const back = () => ((location.hash = '#/'), done());
      return h('div', { class: `isl-row isl-view${on ? ' on' : ''}${isKept ? '' : ' isl-offered'}`, role: 'listitem', 'data-id': v.id, ...(on && { 'aria-current': 'page' }) },
        h('button', { type: 'button', class: 'isl-name', tabindex: '-1', title: on ? `${v.title}: up in place of the islands` : `Put ${v.title} up in place of the islands`, onclick: () => ((location.hash = canvasAt(v)), done()) }, v.title),
        isKept
          ? h('button', { type: 'button', class: `isl-off${on ? '' : ' isl-unkeep'}`, tabindex: '-1', title: on ? 'Back to the islands' : `Take ${v.title} off your list`, 'aria-label': on ? 'Back to the islands' : `Take ${v.title} off your list`, onclick: () => (on ? back() : keepViews(kept.filter((id) => id !== keptBy(v)), `${v.title} taken off the list`).catch((err) => console.warn(err.message))) }, '×')
          : h('button', { type: 'button', class: 'isl-keep', tabindex: '-1', title: `Keep ${v.title} on your list, beside your islands`, onclick: () => keepViews([...kept, keptBy(v)], `${v.title} kept on the list`).catch((err) => console.warn(err.message)) }, 'Keep'));
    };
    list.replaceChildren(...mine.map((v) => row(v, true)), ...offered.map((v) => row(v, false)));
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
