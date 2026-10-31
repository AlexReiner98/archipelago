// A drawing's tip: what it says of a mark, beside that mark. The drawing decides when (it answers an event with a
// patch `{ tip: { key, mark } }`, or `{ tip: null }`) and what, as marks the page checks, styled by its own
// stylesheet; the page keeps only where: beside the mark, above it or below where there is no room. It is shown in
// the top layer, above every bar and pane, and the page's own tip (tip.js) says nothing over the mark meanwhile. The
// mark's title is left to that one, which alone takes titles off and puts them back.

import { h } from './base.js';
import { quietTip } from './tip.js';

/** The one tip of the picture drawn in host: kept on it, so drawing it again does not add another. */
export function tipOf(host) {
  if (host.drawingTip) return host.drawingTip;
  // Kept inside the host, so the drawing's stylesheet reaches it; a popover, so nothing on the page covers it.
  const box = h('div', { class: 'drawing-tip', role: 'tooltip', popover: 'manual', hidden: true });
  let at = null;
  const hide = () => {
    if (at) quietTip(null);
    at = null;
    if (box.matches(':popover-open')) box.hidePopover();
    box.hidden = true;
  };
  /** Show what node says beside el, a mark of the picture. */
  const show = (el, node) => {
    hide();
    if (!el?.isConnected || !host.contains(el)) return;
    at = el;
    quietTip(el);
    if (!box.isConnected) host.append(box);
    box.replaceChildren(node);
    box.hidden = false;
    box.showPopover();
    const mark = el.getBoundingClientRect();
    const half = box.offsetWidth / 2, middle = mark.left + mark.width / 2;
    const below = mark.top < box.offsetHeight;
    box.classList.toggle('below', below);
    box.style.left = `${Math.min(Math.max(middle, half), innerWidth - half)}px`;
    box.style.top = `${below ? mark.bottom : mark.top}px`;
  };
  // Gone when the pointer leaves the picture, or a tap lands elsewhere in it (a tap on a mark may then show its own).
  host.addEventListener('mouseleave', hide);
  host.addEventListener('click', (ev) => at && !at.contains(ev.target) && hide(), true);
  host.drawingTip = { show, hide };
  return host.drawingTip;
}
