// The view band's menu (decision e_yxp78scv): what is done rarely to the canvas the bar acts on. It opens over
// everything, as a tab's menu does (a popover: the band clips what hangs below it), drawn as every open list is
// (ui/menus.css).

import { h } from './base.js';
import { placeBy } from './menu-place.js';

const list = h('div', { class: 'menu-items tab-menu', popover: 'auto', role: 'menu', 'aria-label': 'This view' });
document.body.append(list);

function open(anchor, more) {
  // What is chosen is done and the list shuts.
  const item = (text, title, act, danger) => h('button', { type: 'button', role: 'menuitem', ...(danger && { class: 'danger' }), title, onclick: () => (list.hidePopover(), act()) }, text);
  list.replaceChildren(
    // What the band hands over whole (the layout up, as its switch) stands as it is.
    ...more.filter(Boolean).map((m) => m.element ?? item(m.text, m.title, m.act, m.danger)),
  );
  if (!list.matches(':popover-open')) list.showPopover();
  // By the ⋯, its right edge on the ⋯'s, kept in sight.
  placeBy(list, anchor, { end: true });
}

/** The ⋯ and its menu; `more` are what the band adds for what is up (the layout switch, Delete style, ui/look-switch.js). */
export function canvasMenu(more = []) {
  const button = h('button', { type: 'button', class: 'q-save q-band-menu', title: 'More for this view', 'aria-label': 'More for this view', 'aria-haspopup': 'menu' }, '⋯');
  button.addEventListener('click', () => (list.matches(':popover-open') ? list.hidePopover() : open(button, more)));
  return button;
}
