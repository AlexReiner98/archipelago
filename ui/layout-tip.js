// A drawing's tip: what it says of a mark, beside that mark. The drawing decides when (it answers an event with a
// patch `{ tip: { key, mark } }`, or `{ tip: null }`) and what, as marks the page checks, styled by its own
// stylesheet; the page keeps only where: beside the mark, off what it lights (below). It is shown in
// the top layer, above every bar and pane, and the page's own tip (tip.js) says nothing over the mark meanwhile. The
// mark's title is left to that one, which alone takes titles off and puts them back. Of the places beside the mark
// it takes the one the fewest lit lines (the mark's wires, lit with it) run under: above first, all else even.

import { h } from './base.js';
import { quietTip } from './tip.js';

/** Points along the lines lit in host, on the screen: what the tip keeps off. */
function litPoints(host) {
  const points = [];
  for (const line of host.querySelectorAll('path.lit, line.lit, polyline.lit')) {
    const m = line.getScreenCTM?.(), length = line.getTotalLength?.();
    if (!m || !length) continue;
    const scale = Math.hypot(m.a, m.b), n = Math.min(400, Math.ceil((length * scale) / 6));
    for (let k = 0; k <= n; k++) {
      const p = line.getPointAtLength((length * k) / n);
      points.push([m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f]);
    }
  }
  return points;
}

/** Where a box w by h goes beside mark (top left), in the window, over as few of points as it can. */
function placeOff(mark, w, h, points) {
  const middle = mark.left + mark.width / 2, centre = mark.top + mark.height / 2;
  const tries = [
    [middle - w / 2, mark.top - h], [middle - w / 2, mark.bottom],
    [mark.right, centre - h / 2], [mark.left - w, centre - h / 2],
    [mark.right - w, mark.top - h], [mark.left, mark.top - h],
    [mark.right - w, mark.bottom], [mark.left, mark.bottom],
  ].map(([x, y]) => [Math.min(Math.max(x, 0), innerWidth - w), Math.min(Math.max(y, 0), innerHeight - h)]);
  const over = ([x, y]) => points.filter(([px, py]) => px > x && px < x + w && py > y && py < y + h).length;
  // Pushed back into the window, a place may come to lie over the mark itself: that is the worst of all.
  const onMark = ([x, y]) => x < mark.right && x + w > mark.left && y < mark.bottom && y + h > mark.top;
  const cost = (p) => (onMark(p) ? Infinity : over(p));
  return tries.reduce((best, p) => (cost(p) < cost(best) ? p : best));
}

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
    const [left, top] = placeOff(el.getBoundingClientRect(), box.offsetWidth, box.offsetHeight, litPoints(host));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  };
  // Gone when the pointer leaves the picture, or a tap lands elsewhere in it (a tap on a mark may then show its own).
  host.addEventListener('mouseleave', hide);
  host.addEventListener('click', (ev) => at && !at.contains(ev.target) && hide(), true);
  host.drawingTip = { show, hide };
  return host.drawingTip;
}
