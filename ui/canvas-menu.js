// The view band's menu (decision e_yxp78scv): what is done rarely to the canvas the bar acts on. Arrange lays it out
// again as its drawing does; Fit and Snap are the reader's, kept in this browser, each marked when it is on. What they
// act on is the canvas's own (ui/canvas.js hands it over as hooks.canvasNow). It opens over everything, as a tab's
// menu does (a popover: the band clips what hangs below it), drawn as every open list is (ui/menus.css).

import { h, hooks } from './base.js';
import { placeBy } from './menu-place.js';

const list = h('div', { class: 'menu-items tab-menu', popover: 'auto', role: 'menu', 'aria-label': 'This canvas' });
document.body.append(list);

function open(anchor) {
  const now = hooks.canvasNow;
  if (!now) return;
  // Arrange is done and the list shuts; Fit and Snap are ticks: the list stays, drawn again with what is on.
  const item = (text, title, act, on) =>
    h('button', { type: 'button', role: on === undefined ? 'menuitem' : 'menuitemcheckbox', ...(on !== undefined && { 'aria-checked': String(on) }), title, onclick: () => (on === undefined ? (list.hidePopover(), act()) : (act(), open(anchor))) }, text);
  list.replaceChildren(
    item('Arrange', 'Lay this canvas out again as its drawing does, forgetting where you put things', now.arrange),
    item('Fit', 'Bring all of the drawing into sight on every change; off, the canvas moves only when you move it', () => now.toggle('fit'), Boolean(now.settings.fit)),
    item('Snap', 'Let what you move go on a soft grid', () => now.toggle('snap'), Boolean(now.settings.snap)),
  );
  if (!list.matches(':popover-open')) list.showPopover();
  // By the ⋯, its right edge on the ⋯'s, kept in sight.
  placeBy(list, anchor, { end: true });
}

export function canvasMenu() {
  const button = h('button', { type: 'button', class: 'q-save q-band-menu', title: 'Arrange, Fit, Snap', 'aria-label': 'More for this canvas', 'aria-haspopup': 'menu' }, '⋯');
  button.addEventListener('click', () => (list.matches(':popover-open') ? list.hidePopover() : open(button)));
  return button;
}
