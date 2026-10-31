// The view band's menu (decision e_yxp78scv): what is done rarely to the canvas the bar acts on. Arrange lays it out
// again as its drawing does; Fit and Snap are the reader's, kept in this browser, each marked when it is on. What they
// act on is the canvas's own (ui/canvas.js hands it over as hooks.canvasNow). It opens over everything, as a tab's
// menu does (a popover: the band clips what hangs below it), drawn as every open list is (ui/menus.css).

import { h, hooks } from './base.js';
import { placeBy } from './menu-place.js';

const list = h('div', { class: 'menu-items tab-menu', popover: 'auto', role: 'menu', 'aria-label': 'This view' });
document.body.append(list);

function open(anchor, more) {
  const now = hooks.canvasNow;
  if (!now) return;
  // Arrange is done and the list shuts; Fit and Snap are ticks: the list stays, drawn again with what is on.
  const item = (text, title, act, on, danger) =>
    h('button', { type: 'button', role: on === undefined ? 'menuitem' : 'menuitemcheckbox', ...(on !== undefined && { 'aria-checked': String(on) }), ...(danger && { class: 'danger' }), title, onclick: () => (on === undefined ? (list.hidePopover(), act()) : (act(), open(anchor, more))) }, text);
  list.replaceChildren(
    item('Arrange', 'Lay this view out again as its layout does, forgetting where you put things', now.arrange),
    item('Fit', 'Bring all of the view into sight on every change; off, it moves only when you move it', () => now.toggle('fit'), Boolean(now.settings.fit)),
    item('Snap', 'Let what you move go on a soft grid', () => now.toggle('snap'), Boolean(now.settings.snap)),
    ...(more.some(Boolean) ? [h('hr')] : []),
    ...more.filter(Boolean).map((m) => item(m.text, m.title, m.act, undefined, m.danger)),
  );
  if (!list.matches(':popover-open')) list.showPopover();
  // By the ⋯, its right edge on the ⋯'s, kept in sight.
  placeBy(list, anchor, { end: true });
}

/** The ⋯ and its menu; `more` are what the band adds for what is up (Delete style, ui/look-switch.js). */
export function canvasMenu(more = []) {
  const button = h('button', { type: 'button', class: 'q-save q-band-menu', title: ['Arrange', 'Fit', 'Snap', ...more.filter(Boolean).map((m) => m.text)].join(', '), 'aria-label': 'More for this view', 'aria-haspopup': 'menu' }, '⋯');
  button.addEventListener('click', () => (list.matches(':popover-open') ? list.hidePopover() : open(button, more)));
  return button;
}
