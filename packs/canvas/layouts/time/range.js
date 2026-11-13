// The time drawing's range (index.js), over the picture: how many days of the view's window are drawn (a choice for
// each of the style's ranges, and the whole window), and a step a day back or on through it. Each a word; the one up
// is marked. Its look is ./look.js.

import { dayAt, fmtDay } from './clock.js';
import { m } from './marks.js';

/** The controls for what is up (`now`: span, start) in a window of `days` from `from`, the style's `ranges` offered. */
export function controls(now, { days, from, ranges }) {
  const word = (key, text, on, title) => m('button', { key, on: ['click'], class: `t-control${on ? ' on' : ''}`, title }, text);
  const named = (n) => (n === 1 ? 'Day' : `${n} days`);
  const part = now.span < days;
  const first = dayAt(from, now.start), last = dayAt(from, now.start + now.span - 1);
  return m(
    'div',
    { key: 'tc', class: 't-controls' },
    ...ranges.map((n) => word(`tc:span:${n}`, named(n), now.span === n, `Draw ${n === 1 ? 'one day' : `${n} days`} of this view`)),
    word('tc:span:all', 'All', !part, `Draw the whole window, ${days} days`),
    part && m('span', { class: 't-control-gap' }),
    part && word('tc:prev', '‹', false, 'A day earlier'),
    part && m('span', { class: 't-control-at' }, now.span === 1 ? fmtDay(first) : `${fmtDay(first)} to ${fmtDay(last)}`),
    part && word('tc:next', '›', false, 'A day later'),
  );
}
