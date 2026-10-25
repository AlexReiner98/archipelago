// A picture moved like a map: an SVG in a frame of fixed size, where the wheel zooms about the pointer, a drag moves
// it, and a link is followed only when the pointer did not move. It opens with all of it in sight when that can be
// read, else at a size that reads, brought to where it starts.

/** The scale below which a picture is too small to read: opened, it is shown no smaller, and moved to its start. */
export const READABLE = 0.62;

/**
 * Make `svg` (`width` by `height` in its own units) move inside `frame`. `start` is a point to open on when all of
 * it cannot be read at once; `aside` is room kept on the left for what floats over the frame (a legend).
 * Answers with what a control may do: zoom by a factor, fit it all, open again, bring a point into sight, or say and
 * restore where it stands.
 */
export function panZoom(frame, svg, { width, height, start = [width / 2, 0], aside = 0 }) {
  const view = { s: 1, x: 0, y: 0 };
  let fitted = 1;
  let drag = null;
  const size = () => [Math.max(1, frame.clientWidth), Math.max(1, frame.clientHeight)];
  // However it is moved, some of it stays in sight.
  const clamp = () => {
    const [W, H] = size(), keep = 80 / view.s;
    view.x = Math.min(width - keep, Math.max(view.x, keep - W / view.s));
    view.y = Math.min(height - keep, Math.max(view.y, keep - H / view.s));
  };
  const apply = () => {
    const [W, H] = size();
    clamp();
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${W / view.s} ${H / view.s}`);
  };
  /** All of it in sight, centred in the room beside what floats on the left and what covers the frame's right (`right`). */
  const fit = (right = 0) => {
    const [W, H] = size();
    const room = Math.max(1, W - aside - right);
    fitted = Math.min(1, (room - 16) / width, (H - 16) / height);
    view.s = fitted;
    view.x = -(aside + (room - width * view.s) / 2) / view.s;
    view.y = -((H - height * view.s) / 2) / view.s;
    apply();
  };
  const open = () => {
    fit();
    if (fitted >= READABLE) return;
    const [W] = size();
    view.s = READABLE;
    view.x = start[0] - (aside + (W - aside) / 2) / view.s;
    view.y = start[1] - 16 / view.s;
    apply();
  };
  /** Zoom by a factor about a point of the frame (its middle when none is given). */
  const zoomBy = (factor, px, py) => {
    const [W, H] = size();
    const [mx, my] = [px ?? W / 2, py ?? H / 2];
    const s = Math.min(2, Math.max(fitted * 0.9, view.s * factor));
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
    apply();
  };

  frame.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = frame.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
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
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= 4) return;
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
  const restore = (was) => (Object.assign(view, was), apply());
  return { zoomBy, fit, open, show, state, restore };
}
