// One infinite plane: an SVG in a frame of fixed size, seen through a window that stands in the picture's own units
// (its world). The wheel zooms about the pointer, a drag moves it, and a link is followed only when the pointer did not
// move. Nothing holds it in: it goes as far as the reader takes it. Zoom is only scale, never structure; what is too
// small on screen to read is not drawn (the text's tier, `data-text` on the frame: none, names, all), and what is out
// of sight is not drawn at all. Whoever drew it is told what is in view (`told`), once a frame at most. It opens with
// all of it in sight when that can be read, else at a size that reads, brought to where it starts.

import { numberOf } from './lens-base.js';

/** What a frame of `n` units' text is shown as, on screen at `px` a unit: none, its names, or all of it. */
export const tierOf = (px, { text_least, more_from }) => (px < text_least ? 'none' : px < more_from ? 'names' : 'all');

/** The numbers a plane moves by, the style's (the house style names every one). */
const planeOf = (style) => Object.fromEntries(['zoom_least', 'zoom_most', 'open_least', 'text_least', 'more_from', 'margin', 'wheel', 'drag_from', 'fit_pad'].map((n) => [n, numberOf(style, `plane_${n}`)]));

/**
 * Make `svg` (`width` by `height` in its own units) move inside `frame`. `start` is a point to open on when all of
 * it cannot be read at once; `aside` is room kept on the left for what floats over the frame (a legend); `style` gives
 * the plane's numbers; `told(view)` hears what is in view, in the picture's units, as it changes.
 * Answers with what a control may do: zoom by a factor, fit it all, open again, bring a point into sight, or say and
 * restore where it stands.
 */
export function panZoom(frame, svg, { width, height, start = [width / 2, 0], aside = 0, style, told }) {
  const plane = planeOf(style);
  const view = { s: 1, x: 0, y: 0 };
  let fitted = 1;
  let drag = null;
  const size = () => [Math.max(1, frame.clientWidth), Math.max(1, frame.clientHeight)];

  // ---- What is drawn: each mark of the picture with where it lies, read once and again when the drawing moves one.
  let marks = null, textPx = 0;
  const box = (el) => {
    try {
      const b = el.getBBox();
      const m = el.transform?.baseVal?.consolidate()?.matrix;
      return m ? [b.x + m.e, b.y + m.f, b.x + b.width + m.e, b.y + b.height + m.f] : [b.x, b.y, b.x + b.width, b.y + b.height];
    } catch {
      return null;
    }
  };
  // The marks are what is directly in the picture, and in a bare group directly in it (a layer).
  const read = () => {
    const els = [...svg.children].flatMap((el) => (el.tagName === 'g' && !el.attributes.length ? [...el.children] : [el]));
    marks = els.filter((el) => el.tagName !== 'defs' && el.tagName !== 'title').map((el) => ({ el, at: box(el), off: el.getAttribute('display') === 'none' }));
    const text = svg.querySelector('text');
    textPx = text ? parseFloat(getComputedStyle(text).fontSize) || 0 : 0;
  };
  // A drawing that moves, adds or takes away a mark has it read again before the plane next moves.
  new MutationObserver(() => (marks = null)).observe(svg, { subtree: true, childList: true, attributes: true, attributeFilter: ['d', 'transform', 'x', 'y', 'cx', 'cy', 'width', 'height', 'points'] });

  /** What is in view, in the picture's units, a margin round it drawn too so a short move shows nothing missing. */
  const inView = () => {
    const [W, H] = size();
    return { x: view.x, y: view.y, width: W / view.s, height: H / view.s, scale: view.s };
  };
  const cull = (v) => {
    if (!marks) read();
    const mx = v.width * plane.margin, my = v.height * plane.margin;
    const l = v.x - mx, t = v.y - my, r = v.x + v.width + mx, b = v.y + v.height + my;
    for (const m of marks) {
      // A mark whose place cannot be read (not drawn yet) is always drawn.
      const off = Boolean(m.at) && (m.at[2] < l || m.at[0] > r || m.at[3] < t || m.at[1] > b);
      if (off === m.off) continue;
      m.off = off;
      if (off) m.el.setAttribute('display', 'none');
      else m.el.removeAttribute('display');
    }
    if (textPx) frame.dataset.text = tierOf(textPx * v.scale, plane);
  };

  // Moved many times in a frame, it is drawn once, at the frame.
  let queued = 0, last = '';
  const draw = () => {
    queued = 0;
    const v = inView();
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.width} ${v.height}`);
    cull(v);
    const said = `${v.x} ${v.y} ${v.width} ${v.height}`;
    if (told && said !== last) ((last = said), told(v));
  };
  const apply = () => (queued ||= requestAnimationFrame(draw));
  /** Drawn now, not at the next frame: a control's answer, or a frame first given a size. */
  const now = () => (queued && cancelAnimationFrame(queued), draw());

  /**
   * All of it in sight, centred in the room beside what floats on the left and what covers the frame's right (`right`),
   * and between what floats over its top and its foot (`top`, `bottom`: the bars).
   */
  const fit = (right = 0, top = 0, bottom = 0) => {
    const [W, H] = size();
    const room = Math.max(1, W - aside - right);
    const tall = Math.max(1, H - top - bottom);
    fitted = Math.min(1, (room - plane.fit_pad) / width, (tall - plane.fit_pad) / height);
    view.s = fitted;
    view.x = -(aside + (room - width * view.s) / 2) / view.s;
    view.y = -(top + (tall - height * view.s) / 2) / view.s;
    now();
  };
  const open = () => {
    fit();
    if (fitted >= plane.open_least) return;
    const [W] = size();
    view.s = plane.open_least;
    view.x = start[0] - (aside + (W - aside) / 2) / view.s;
    view.y = start[1] - plane.fit_pad / view.s;
    now();
  };
  /** Zoom by a factor about a point of the frame (its middle when none is given): only the scale, never what is drawn. */
  const zoomBy = (factor, px, py) => {
    const [W, H] = size();
    const [mx, my] = [px ?? W / 2, py ?? H / 2];
    const s = Math.min(plane.zoom_most, Math.max(Math.min(plane.zoom_least, fitted), view.s * factor));
    view.x += mx / view.s - mx / s;
    view.y += my / view.s - my / s;
    view.s = s;
    apply();
  };

  /** Bring a point of the picture to the middle of what is in sight, less `right` of the frame covered on its right. */
  const show = (px, py, right = 0) => {
    const [W, H] = size();
    view.x = px - (W - right) / 2 / view.s;
    view.y = py - H / 2 / view.s;
    now();
  };

  frame.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = frame.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * plane.wheel), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  frame.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragged = false;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, id: e.pointerId };
  });
  frame.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= plane.drag_from) return;
    if (!drag.moved) {
      drag.moved = true;
      frame.classList.add('moving');
      // Held, so the drag goes on outside the frame; a pointer that cannot be held still drags inside it.
      try {
        frame.setPointerCapture(e.pointerId);
      } catch {}
    }
    view.x = drag.vx - dx / view.s;
    view.y = drag.vy - dy / view.s;
    apply();
  });
  // The click that ends a drag is not a click on what it ended over.
  let dragged = false;
  frame.addEventListener('click', (e) => dragged && (e.preventDefault(), e.stopPropagation()), { capture: true });
  const end = () => {
    frame.classList.remove('moving');
    dragged = Boolean(drag?.moved);
    drag = null;
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  // A frame that changes size keeps what was in sight; one first given a size opens.
  let opened = Boolean(frame.clientWidth);
  if (opened) open();
  new ResizeObserver(() => (frame.clientWidth ? (opened ? apply() : ((opened = true), open())) : null)).observe(frame);
  /** Where it stands now, and put back where it stood (a picture drawn again, kept where the reader left it). */
  const state = () => ({ ...view });
  const restore = (was) => (Object.assign(view, was), now());
  return { zoomBy, fit, open, show, state, restore, inView };
}
