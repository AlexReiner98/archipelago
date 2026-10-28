// The view band's menu (decision e_yxp78scv): what is done rarely to the canvas the bar acts on. Arrange lays it out
// again as its drawing does; Fit and Snap are the reader's, kept in this browser, each marked when it is on. What they
// act on is the canvas's own (ui/canvas.js hands it over as hooks.canvasNow).

import { h, hooks } from './base.js';

export function canvasMenu() {
  const box = h('details', { class: 'menu q-band-menu' }, h('summary', { title: 'Arrange, Fit, Snap', 'aria-label': 'More for this canvas' }, '⋯'));
  const now = hooks.canvasNow;
  if (!now) return box;
  // A toggle draws the menu again, so its mark says what is on now.
  const item = (text, title, onclick, on) => h('button', { type: 'button', title, 'aria-pressed': on === undefined ? undefined : String(on), onclick: () => ((box.open = false), onclick(), on !== undefined && box.replaceWith(canvasMenu())) }, on ? `✓ ${text}` : text);
  box.append(
    h(
      'div',
      { class: 'menu-items' },
      item('Arrange', 'Lay this canvas out again as its drawing does, forgetting where you put things', now.arrange),
      item('Fit', 'Bring all of the drawing into sight on every change; off, the canvas moves only when you move it', () => now.toggle('fit'), Boolean(now.settings.fit)),
      item('Snap', 'Let what you move go on a soft grid', () => now.toggle('snap'), Boolean(now.settings.snap)),
    ),
  );
  return box;
}
