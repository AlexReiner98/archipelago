// A plate: a small card in a grid, open, drawn as the theme swatches are but larger (the owner, 27 Oct 2026). Its head
// is a name, its marks and one action; under it a line it says, the rows that control what it holds, and its counts
// at its foot. Laid out by the .plates grid; how it looks is the stylesheet's, every length a style's.

import { h } from './base.js';

/** A plate: its head (a name, marks, one action), a line it says, rows of controls, and counts at its foot. */
export function plate({ name, title, marks, action, says, rows, foot, off }) {
  return h(
    'section',
    { class: `plate${off ? ' off' : ''}` },
    h('div', { class: 'plate-head' }, h('span', { class: 'grow', title: title ?? '' }, h('span', { class: 'plate-name' }, name)), marks, action),
    says && h('div', { class: 'plate-says', title: says }, says),
    rows?.flat(Infinity).filter(Boolean).length > 0 && h('ul', { class: 'rows' }, rows),
    foot && h('div', { class: 'plate-foot', title: foot.title ?? '' }, foot.text),
  );
}

/** The grid plates sit in. */
export const plates = (...kids) => h('div', { class: 'plates' }, ...kids);
