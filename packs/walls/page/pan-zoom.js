// One infinite plane: an SVG in a frame of fixed size, seen through a window that stands in the picture's own units
// (its world). The wheel or two fingers zoom about the pointer, a drag moves it, and a link is followed only when the
// pointer did not move. Nothing holds it in: it goes as far as the reader takes it. Zoom is only scale, never structure; what is too
// small on screen to read is not drawn (the text's tier, `data-text` on the frame: none, names, all), and what is out
// of sight is not drawn at all. Whoever drew it is told what is in view (`told`), once a frame at most. It opens with
// all of it in sight when that can be read, else at a size that reads, brought to where it starts. The host's: it knows
// nothing of the app, so what stands beside the frame (the sheet) is said by whoever makes one (`beside`).

import { numberOf } from './style-number.js';
import { pinchOf } from './pinch.js';

/** What a frame of `n` units' text is shown as, on screen at `px` a unit: none, its names, or all of it. */
export const tierOf = (px, { text_least, more_from }) => (px < text_least ? 'none' : px < more_from ? 'names' : 'all');

/** The numbers a plane moves by, the style's (the house style names every one). */
const planeOf = (style) => Object.fromEntries(['zoom_least', 'zoom_most', 'open_least', 'fit_least', 'text_least', 'more_from', 'margin', 'wheel', 'drag_from', 'fit_pad'].map((n) => [n, numberOf(style, `plane_${n}`)]));

/**
 * Where to stand to see the box [l, t, r, b] of a picture in a room `room` [left, top, width, height] of the frame,
 * `pad` kept round it: all of it, centred, when that is at least `least` a unit; else at `least`, from its top left, each
 * way it does not fit (a way it fits is still centred, or down from the room's top where `high`: a page read from its top).
 * Answers the view { s, x, y } and the scale that shows all of it.
 */
export function framed([l, t, r, b], [rl, rt, rw, rh], pad, least = 0, high = false) {
  const w = Math.max(1, r - l), hh = Math.max(1, b - t);
  const whole = Math.min(1, (rw - pad) / w, (rh - pad) / hh);
  const s = Math.max(whole, least);
  const along = (from, size, start, room, centred) => (centred && size * s <= room - pad ? from - (start + (room - size * s) / 2) / s : from - (start + pad / 2) / s);
  return { s, x: along(l, w, rl, rw, true), y: along(t, hh, rt, rh, !high), whole };
}

/**
 * Which of these boxes [l, t, r, b] (islands, in the order they are read) open in sight together at a size that reads:
 * the most from the first on whose union `framed` shows whole at `least` or more. Answers their count, and the union;
 * none (a first box too big to read whole) answers that first box alone, to be shown from its top left.
 */
export function leading(boxes, room, pad, least) {
  let union = null, n = 0;
  for (const [l, t, r, b] of boxes) {
    const next = union ? [Math.min(union[0], l), Math.min(union[1], t), Math.max(union[2], r), Math.max(union[3], b)] : [l, t, r, b];
    if (framed(next, room, pad).whole < least) break;
    union = next;
    n += 1;
  }
  return n ? { n, box: union } : { n: boxes.length ? 1 : 0, box: boxes[0] ?? null };
}

/**
 * Make `svg` (`width` by `height` in its own units) move inside `frame`. `start` is a point to open on when all of
 * it cannot be read at once; `aside` is room kept on the left for what floats over the frame (a legend); `style` gives
 * the plane's numbers; `told(view)` hears what is in view, in the picture's units, as it changes; `beside()` says the
 * share of the page's width something stands beside the frame (the app's sheet), so its coming or going leaves the
 * picture where it is.
 * Answers with what a control may do: zoom by a factor, fit it all, open again, bring a point into sight, or say and
 * restore where it stands.
 */
export function panZoom(frame, svg, { width, height, start = [width / 2, 0], aside = 0, style, told, beside: besideOf = () => 0 }) {
  const plane = planeOf(style);
  const view = { s: 1, x: 0, y: 0 };
  let fitted = 1;
  let drag = null;
  /** Who hears each view drawn, beside the drawing (`told`): what stands over the frame and follows it (./canvas-edge.js). */
  const watching = new Set();
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
  // The marks are what is directly in the picture, and in a bare group directly in it (a layer). Each is measured shown:
  // a mark not drawn has no box (a browser answers one at the origin), and kept so it would stay out of sight wherever
  // the reader went, until the origin came into view (e_wsexbmgf). The cull that follows puts out what is not in view.
  const read = () => {
    const els = [...svg.children].flatMap((el) => (el.tagName === 'g' && !el.attributes.length ? [...el.children] : [el])).filter((el) => el.tagName !== 'defs' && el.tagName !== 'title');
    for (const el of els) el.removeAttribute('display');
    marks = els.map((el) => ({ el, at: box(el), off: false }));
    const text = svg.querySelector('text');
    textPx = text ? parseFloat(getComputedStyle(text).fontSize) || 0 : 0;
  };
  // A drawing that moves, adds or takes away a mark has it read again before the plane next moves.
  const reshaped = new MutationObserver(() => (marks = null));
  reshaped.observe(svg, { subtree: true, childList: true, attributes: true, attributeFilter: ['d', 'transform', 'x', 'y', 'cx', 'cy', 'width', 'height', 'points'] });

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
    for (const f of watching) f(v);
    // The scale, for what keeps its size on screen at any zoom (an island's header text, lane 2, overlap e_mb3n6uwb).
    frame.style.setProperty('--ln-plane-scale', String(v.scale));
    cull(v);
    const said = `${v.x} ${v.y} ${v.width} ${v.height}`;
    if (told && said !== last) ((last = said), told(v));
  };
  const apply = () => (queued ||= requestAnimationFrame(draw));
  /** Drawn now, not at the next frame: a control's answer, or a frame first given a size. */
  const now = () => (queued && cancelAnimationFrame(queued), draw());

  /**
   * All of it in sight, centred in the room beside what floats on the left and what covers the frame's right (`right`),
   * and between what floats over its top and its foot (`top`, `bottom`: the bars). `readable`: never smaller than the
   * style's least readable scale (`plane_fit_least`), what does not fit then reached by panning from its top left.
   * `high`: standing at the top of the room, under the bars, not centred down it (the canvas, opened on its islands).
   */
  const fit = (right = 0, top = 0, bottom = 0, readable = false, high = false) => {
    fitted = toBox([0, 0, width, height], right, top, bottom, readable, high);
  };
  /** The room the picture is seen in, beside and between what covers the frame. */
  const roomOf = (right, top, bottom) => {
    const [W, H] = size();
    return [aside, top, Math.max(1, W - aside - right), Math.max(1, H - top - bottom)];
  };
  /** A box of the picture [l, t, r, b] in sight as fit puts all of it (an island, by whoever knows where it lies): the scale that shows all of it. */
  const toBox = (box, right = 0, top = 0, bottom = 0, readable = true, high = false) => {
    const { s, x, y, whole } = framed(box, roomOf(right, top, bottom), plane.fit_pad, readable ? plane.fit_least : 0, high);
    Object.assign(view, { s, x, y });
    now();
    return whole;
  };
  /**
   * Open readable on these boxes (islands, in reading order): as many from the first as read whole together, standing at
   * the top of the room; zooming out still reaches all of it. Answers how many are in sight.
   */
  const openOn = (boxes, right = 0, top = 0, bottom = 0) => {
    const { n, box } = leading(boxes, roomOf(right, top, bottom), plane.fit_pad, plane.fit_least);
    if (!box) return 0;
    fitted = Math.min(fitted, framed([0, 0, width, height], roomOf(right, top, bottom), plane.fit_pad).whole);
    toBox(box, right, top, bottom, true, true);
    return n;
  };
  /** Hear each view as it is drawn; answers how to stop. */
  const watch = (f) => (watching.add(f), () => watching.delete(f));
  const open = () => {
    fit();
    if (fitted >= plane.open_least) return;
    const [W] = size();
    view.s = plane.open_least;
    view.x = start[0] - (aside + (W - aside) / 2) / view.s;
    view.y = start[1] - plane.fit_pad / view.s;
    now();
  };
  /** A scale kept between the least and the most, the least never above what shows all of it. */
  const scaled = (s) => Math.min(plane.zoom_most, Math.max(Math.min(plane.zoom_least, fitted), s));
  /** Zoom by a factor about a point of the frame (its middle when none is given): only the scale, never what is drawn. */
  const zoomBy = (factor, px, py) => {
    const [W, H] = size();
    const [mx, my] = [px ?? W / 2, py ?? H / 2];
    const s = scaled(view.s * factor);
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
  // Any press starts afresh, on a mark that keeps its press to itself too: seen on its way down.
  frame.addEventListener('pointerdown', () => (dragged = false), { capture: true });
  frame.addEventListener('click', (e) => dragged && (e.preventDefault(), e.stopPropagation()), { capture: true });
  const end = () => {
    if (!drag) return;
    frame.classList.remove('moving');
    dragged = drag.moved;
    drag = null;
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  // Two fingers keep the point between them under them, however they move: the pan one began ends, as a drag does.
  let held = null;
  pinchOf(frame, {
    begin: ([x, y]) => {
      if (drag) ((drag.moved = true), end());
      dragged = true;
      held = { s: view.s, x: view.x + x / view.s, y: view.y + y / view.s };
    },
    pinch: (by, [x, y]) => {
      view.s = scaled(held.s * by);
      view.x = held.x - x / view.s;
      view.y = held.y - y / view.s;
      apply();
    },
  });
  // A frame that changes size keeps what was in the middle of it in the middle (a pane whose edge is dragged does not
  // carry the picture with that edge), but the sheet coming or going leaves it where the reader put it: only the room
  // beside it changes. One first given a size opens.
  let opened = Boolean(frame.clientWidth), was = size(), beside = besideOf();
  if (opened) open();
  /** Taken off the page, the frame's observers end with it. */
  const stop = () => (resized.disconnect(), reshaped.disconnect());
  const resized = new ResizeObserver(() => {
    if (!frame.isConnected) return stop();
    if (!frame.clientWidth) return;
    const now = size();
    if (!opened) return void ((opened = true), (was = now), open());
    const stays = besideOf() !== beside;
    if (!stays) view.x += (was[0] - now[0]) / 2 / view.s;
    view.y += (was[1] - now[1]) / 2 / view.s;
    was = now;
    beside = besideOf();
    apply();
  });
  resized.observe(frame);
  /** Where it stands now, and put back where it stood (a picture drawn again, kept where the reader left it). */
  const state = () => ({ ...view });
  const restore = (was) => (Object.assign(view, was), now());
  /** Where a mark of the picture lies [l, t, r, b], in its units: the mark drawn directly in it that holds `el`. */
  // Measured as the cull measures it (a mark out of sight has no box of its own now).
  const boxOf = (el) => {
    if (!marks) read();
    return marks.find((m) => m.el.contains(el))?.at ?? null;
  };
  return { zoomBy, fit, toBox, openOn, watch, boxOf, open, show, state, restore, inView, stop, room: roomOf };
}
