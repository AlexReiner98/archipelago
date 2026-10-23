// A drawing's tip: what it says of a mark, beside that mark. The drawing decides when (it answers an event with a
// patch `{ tip: { key, mark } }`, or `{ tip: null }`) and what, as marks the page checks, styled by its own
// stylesheet; the page keeps only where: beside the mark, above it or below where there is no room, inside the
// picture. While a tip is up, the mark's own title is set aside, so the browser does not say the same again.

import { h } from './base.js';

/** The one tip of the picture drawn in host: kept on it, so drawing it again does not add another. */
export function tipOf(host) {
  if (host.drawingTip) return host.drawingTip;
  const box = h('div', { class: 'drawing-tip', role: 'tooltip', hidden: true });
  let at = null;
  const hide = () => {
    if (at?.title) at.el.prepend(at.title);
    at = null;
    box.hidden = true;
  };
  /** Show what node says beside el, a mark of the picture. */
  const show = (el, node) => {
    hide();
    if (!el?.isConnected || !host.contains(el)) return;
    const title = [...el.children].find((kid) => kid.tagName.toLowerCase() === 'title');
    title?.remove();
    at = { el, title };
    if (!box.isConnected) host.append(box);
    box.replaceChildren(node);
    box.hidden = false;
    const mark = el.getBoundingClientRect(), frame = host.getBoundingClientRect();
    const half = box.offsetWidth / 2, middle = mark.left + mark.width / 2 - frame.left;
    const below = mark.top - frame.top < box.offsetHeight;
    box.classList.toggle('below', below);
    box.style.left = `${Math.min(Math.max(middle, half), host.clientWidth - half)}px`;
    box.style.top = `${(below ? mark.bottom : mark.top) - frame.top}px`;
  };
  // Gone when the pointer leaves the picture, or a tap lands elsewhere in it (a tap on a mark may then show its own).
  host.addEventListener('mouseleave', hide);
  host.addEventListener('click', (ev) => at && !at.el.contains(ev.target) && hide(), true);
  host.drawingTip = { show, hide };
  return host.drawingTip;
}
