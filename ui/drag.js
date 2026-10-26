// A mark moved by hand: the page follows a press on a mark that asked for `drag` (ui/marks.js) and tells the drawing
// where it is, in the picture's own units, each frame (`drag`) and once where it is let go (`drop`); the drawing moves
// it and what is tied to it. The drawing sees only the distance moved, never the pointer or the page. Let go, a mark
// that is a link to an item says so to whoever keeps where things were put (the canvas: a `drawing-drop` event on the
// picture's host, with the item and where its middle now is). A press that hardly moves is a click, as before.
//
// A press on the edge of a step that links to an item (within the style's `wire_edge` of its outline, on screen), or
// anywhere on it with Alt held, draws a wire instead: a line follows the pointer, and let go on another such step,
// the picture's host is told (`drawing-wire`, from and to), for whoever makes the link (the canvas). The pointer says
// which it will be before the press: a cross on the edge, a hand inside. The drawing is told nothing of a wire.

import { sizeOf } from './lens-base.js';

const SVG = 'http://www.w3.org/2000/svg';
/** The item a mark links to, or null. */
const itemOf = (el) => /^#\/e\/(e_[a-z0-9]{8})$/.exec(el?.getAttribute?.('href') ?? '')?.[1] ?? null;
/** Whether a press at this point of the screen draws a wire from this mark: on its edge, or with Alt held. */
function wiring(el, e, style) {
  if (!itemOf(el)) return false;
  if (e.altKey) return true;
  // Never more than a quarter of the step across, so a step drawn small still has a middle to move it by.
  const r = el.getBoundingClientRect(), band = Math.min(sizeOf(style, 'wire_edge'), r.width / 4, r.height / 4);
  return Math.min(e.clientX - r.left, r.right - e.clientX, e.clientY - r.top, r.bottom - e.clientY) < band;
}
/** The pointer over a step says what a press there does: `data-wire="edge"` on the host while it would draw a wire. */
export function wireHover(host, style) {
  if (host.wireHover) return;
  host.wireHover = true;
  host.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('svg a[href]');
    const edge = Boolean(el && wiring(el, e, style));
    if ((host.dataset.wire === 'edge') !== edge) edge ? (host.dataset.wire = 'edge') : delete host.dataset.wire;
  }, { passive: true });
}

/** Follow a press that draws a wire from `el`, the line drawn in its picture; let go on another item's mark, the host is told. */
function drawWire(host, el, ev, at) {
  const svg = el.ownerSVGElement, from = itemOf(el);
  const box = el.getBBox(), shift = el.transform?.baseVal?.consolidate?.()?.matrix;
  const [x1, y1] = [box.x + box.width / 2 + (shift?.e ?? 0), box.y + box.height / 2 + (shift?.f ?? 0)];
  const line = document.createElementNS(SVG, 'line');
  line.setAttribute('class', 'wire-draft');
  for (const [k, v] of Object.entries({ x1, y1, x2: x1, y2: y1 })) line.setAttribute(k, String(v));
  svg.append(line);
  el.classList.add('wiring');
  const over = (e) => {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('a[href]');
    return target && target.ownerSVGElement === svg && itemOf(target) !== from ? itemOf(target) : null;
  };
  const move = (e) => {
    const p = at(e);
    line.setAttribute('x2', String(p.x));
    line.setAttribute('y2', String(p.y));
    line.classList.toggle('onto', Boolean(over(e)));
  };
  const up = (e) => {
    removeEventListener('pointermove', move);
    line.remove();
    el.classList.remove('wiring');
    // The click that ends a wire opens neither end.
    svg.addEventListener('click', (c) => (c.preventDefault(), c.stopPropagation()), { capture: true, once: true });
    const to = over(e);
    if (to) host.dispatchEvent(new CustomEvent('drawing-wire', { bubbles: true, detail: { from, to } }));
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up, { once: true });
}

/** The drag of one picture: `send(event)` tells its drawing; with `style.snap` on, where a mark is let go is rounded to the style's grid (`sizes.snap`). */
export function dragOf(host, keys, send, style) {
  return (key, ev) => {
    const el = keys.get(key);
    const svg = el?.ownerSVGElement;
    if (!svg || ev.button !== 0) return;
    // The press is the mark's, not the frame's: the picture does not pan under it.
    ev.stopPropagation();
    const at = (e) => {
      const p = svg.createSVGPoint();
      [p.x, p.y] = [e.clientX, e.clientY];
      return p.matrixTransform(svg.getScreenCTM().inverse());
    };
    if (wiring(el, ev, style)) return drawWire(host, el, ev, at);
    const start = at(ev), box = el.getBBox();
    // Where it is now: where it was drawn, and where a drag before this moved it to (its transform).
    const shift = el.transform?.baseVal?.consolidate?.()?.matrix;
    const middle = [box.x + box.width / 2 + (shift?.e ?? 0), box.y + box.height / 2 + (shift?.f ?? 0)];
    const scale = svg.getScreenCTM().a;
    let moved = false, frame = 0, by = [0, 0];
    // Let go on a grid, when the reader asked for one: the middle on the nearest line.
    // Never above or left of the picture's corner, where it could not be seen.
    const snapped = ([dx, dy]) => {
      const g = style.snap ? Number(style.sizes?.snap) : 0;
      const [x, y] = g > 0 ? [Math.round((middle[0] + dx) / g) * g, Math.round((middle[1] + dy) / g) * g] : [middle[0] + dx, middle[1] + dy];
      return [Math.max(x, box.width / 2) - middle[0], Math.max(y, box.height / 2) - middle[1]];
    };
    const move = (e) => {
      const p = at(e);
      by = [p.x - start.x, p.y - start.y];
      if (!moved && Math.hypot(...by) * scale < 4) return;
      moved = true;
      el.classList.add('dragging');
      frame ||= requestAnimationFrame(() => ((frame = 0), send({ key, name: 'drag', dx: by[0], dy: by[1] })));
    };
    const up = () => {
      removeEventListener('pointermove', move);
      cancelAnimationFrame(frame);
      el.classList.remove('dragging');
      if (!moved) return;
      // The click that ends a drag does not open what was dragged.
      el.addEventListener('click', (e) => (e.preventDefault(), e.stopPropagation()), { capture: true, once: true });
      const [dx, dy] = snapped(by);
      send({ key, name: 'drop', dx, dy });
      const id = itemOf(el);
      if (id) host.dispatchEvent(new CustomEvent('drawing-drop', { bubbles: true, detail: { id, x: middle[0] + dx, y: middle[1] + dy } }));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up, { once: true });
  };
}
