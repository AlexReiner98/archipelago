// The aim as a Ridges range (round 6, screen e_vm8eg36x, pass 7): the one item drawn as a real landform rising out of its box,
// the rest being trail markers. A main summit off centre, a lower shoulder on the other side and foothills in front, each layer
// stair-stepped as Ridges builds a row (./ridge-item.js profile), back to front with the inked outline; the two behind are
// neutral tints, the front is painted in the item's status colour (its blaze). Seeded by the item's id, so each aim's range
// differs a little and is the same each time. The range stands on the box's top edge, centred on the box.
// Layer: marks. Pure: an id, a place and a form in, marks out.

import { profile, seedOf, skyline, steps } from './ridge-item.js';

/** A profile moved `k` columns along, ground (0) where it left. */
const shift = (heights, k) => heights.map((_, i) => heights[i - k] ?? 0);

/**
 * The layers of the range, back to front, as heights over `cols` columns: the main summit and its shoulder (one skyline, the
 * higher of the two), a lower range, and the foothills in front. `form` is the aim's landform (ridge_forms): its dials set the
 * peaks, the rest are made from it.
 */
export function rangeLayers(id, form, cols) {
  const seed = seedOf(id), lean = (seed % 2 ? 1 : -1) * Math.round(cols * 0.12);
  const main = shift(profile({ ...form, span: 0.55, summits: 1 }, seed, cols), lean);
  const shoulder = shift(profile({ ...form, rise: (form.rise ?? 1) * 0.55, span: 0.5, summits: 1, rugged: 0.3 }, seed + 1, cols), -lean * 2);
  const back = main.map((h, i) => Math.max(h, shoulder[i]));
  const mid = profile({ ...form, rise: (form.rise ?? 1) * 0.8, span: 0.95, summits: 2, rugged: 0.3 }, seed + 2, cols);
  const front = profile({ ...form, rise: (form.rise ?? 1) * 0.6, span: 1, summits: 2 + (seed % 2), rugged: 0.4, atoll: false }, seed + 1 + 2, cols);
  return [back, mid, front];
}

/**
 * The marks of an aim's range over the box's top edge `base`, across `x0..x1`, up to `rise` tall. `word` is the item's status
 * (its class paints the front layer; an ended aim is outline only); `m` makes a mark.
 */
export function rangeMarks({ id, form, x0, x1, base, rise, word, m, cols }) {
  const [back, mid, front] = rangeLayers(id, form, cols), top = Math.max(...back, Number.EPSILON), scale = rise / top;
  const classes = word === 'ended' ? ['lf-range-bare', 'lf-range-bare', 'lf-range-bare'] : ['lf-range-1', 'lf-range-2', `lf-cut-s-${word}`];
  return [back, mid, front].flatMap((heights, k) => [
    m('path', { class: `lf-range ${classes[k]}`, d: steps(heights, x0, x1, base, scale) }),
    m('path', { class: 'lf-range-ink', d: skyline(heights, x0, x1, base, scale) }),
  ]);
}

/** The range as one small line over a key swatch: its skyline from the box's top `base` up to `top`, across `x0..x1`. */
export function rangeKeyPath(x0, x1, top, base, cols) {
  const heights = rangeLayers('key', { rise: 1, span: 1, power: 2 }, cols)[0];
  return skyline(heights, x0, x1, base, base - top);
}
