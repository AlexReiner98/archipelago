// A drawing's tip: what it says of a mark, beside that mark. The drawing decides when (it answers an event with a
// patch `{ tip: { key, mark } }`, or `{ tip: null }`) and what, as marks the page checks, styled by its own
// stylesheet; the page keeps only where: beside the mark, above it or below where there is no room. It is shown in
// the top layer, above every bar and pane, and the page's own tip (tip.js) says nothing over the mark meanwhile. The
// mark's title is left to that one, which alone takes titles off and puts them back. A picture drawn again (a change
// on the map) takes the tip off with its old marks: it is carried to the same mark in the new one while the pointer is
// still on it, so it does not blink out until the drawing has answered for that mark again.

import { h } from './base.js';
import { quietTip } from './tip.js';

/** The one tip of the picture drawn in host: kept on it, so drawing it again does not add another. */
export function tipOf(host) {
  if (host.drawingTip) return host.drawingTip;
  // Kept inside the host, so the drawing's stylesheet reaches it; a popover, so nothing on the page covers it.
  const box = h('div', { class: 'drawing-tip', role: 'tooltip', popover: 'manual', hidden: true });
  let at = null;
  /** What the tip says and of which mark's key, to carry it into a picture drawn again; and where the pointer was. */
  let said = null, pointer = null;
  const hide = () => {
    if (at) quietTip(null);
    at = null;
    said = null;
    if (box.matches(':popover-open')) box.hidePopover();
    box.hidden = true;
  };
  /** Show what node says beside el, a mark of the picture (named by key). */
  const show = (el, node, key) => {
    hide();
    if (!el?.isConnected || !host.contains(el)) return;
    at = el;
    said = { key, node };
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
  host.addEventListener('pointermove', (ev) => (pointer = [ev.clientX, ev.clientY]), { passive: true });
  /**
   * The picture was drawn again, its marks now in keys: the tip stays on the same mark if the pointer is on it, else
   * goes. Looked at the next frame, before it is painted: by then the picture is back where the reader left it (canvas.js).
   */
  const carry = (keys) => requestAnimationFrame(() => {
    if (!said) return;
    const el = keys.get(String(said.key)), under = pointer && document.elementFromPoint(...pointer);
    if (el?.isConnected && under && el.contains(under)) show(el, said.node, said.key);
    else hide();
  });
  host.addEventListener('click', (ev) => at && !at.contains(ev.target) && hide(), true);
  host.drawingTip = { show, hide, carry };
  return host.drawingTip;
}
