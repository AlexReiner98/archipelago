// A surface: a canvas the page lays under a drawing's picture when its scene asks for one (`surface: { key }`), for
// pixels the drawing paints in its worker, in the sandbox, as a layout's code paints (three.js is offered to it
// there). The drawing paints on a canvas of its own in the worker and sends each finished frame as an image; the page
// shows it here. Nothing but pixels crosses: what comes is checked to be an image (and the view it was painted at, as
// numbers), and nothing of the page goes back but the surface's size and the page's colours. It lies exactly under the
// picture, so the picture's marks stand on its paint; it takes no pointer, and is shown or hidden by the drawing's own
// classes (its key, like any mark's). The drawing is told of it only when it asks, so a picture that never paints in
// it costs nothing.
//
// One camera: the page's. The plane moves the picture by its viewBox at once; a frame from the worker comes a frame
// or more later, painted where the camera stood then. So the frame shown is moved by the page, in the same frame as
// the marks, by how far the camera has gone since it was painted (a translate and a scale of the canvas), and lies
// still again once a frame painted where the camera rests comes.

import { h } from './base.js';

/** The view a frame was painted at, as the page's plane says it ({ x, y, width }): numbers, or none. */
const viewOf = (at) => {
  const v = at && [at.x, at.y, at.width].map(Number);
  return v && v.every(Number.isFinite) && v[2] > 0 ? { x: v[0], y: v[1], width: v[2] } : null;
};

/** How a frame painted at view `at` is moved to stand under the picture seen at `now`, on a surface `wide` pixels across. */
export const movedBy = (at, now, wide) => {
  if (!at || !now || !(wide > 0)) return '';
  const k = wide / now.width, s = at.width / now.width;
  // Under a hundredth of a pixel is where it was painted: the sums' dust, not a move.
  const near = (v, to) => Math.abs(v - to) < 0.01;
  const dx = (at.x - now.x) * k, dy = (at.y - now.y) * k;
  return near(dx, 0) && near(dy, 0) && near(s * wide, wide) ? '' : `translate(${dx}px, ${dy}px) scale(${s})`;
};

/** A surface under `picture`, spoken of over `port`; `colours()` is how the page is coloured when the drawing asks. */
export function surfaceOf(picture, port, colours) {
  const canvas = h('canvas', { class: 'lf-surface', 'aria-hidden': 'true' });
  let given = false, shown = null, firstSeen, wide = 0, painted = null;
  const first = new Promise((r) => (firstSeen = r));
  const sizeNow = () => {
    const box = picture.getBoundingClientRect();
    return { width: box.width, height: box.height, dpr: Math.min(devicePixelRatio || 1, 2) };
  };
  // Where the camera stands now: the picture's viewBox, as the plane set it.
  const camera = () => {
    const b = picture.viewBox?.baseVal;
    return b && b.width > 0 ? { x: b.x, y: b.y, width: b.width } : null;
  };
  const follow = () => {
    canvas.style.transform = movedBy(painted, camera(), wide);
  };
  // Under the picture, wherever the stage puts it: its box, from the stage's corner.
  const place = () => {
    const box = picture.getBoundingClientRect(), stage = canvas.parentElement?.getBoundingClientRect();
    if (!stage) return;
    wide = box.width;
    Object.assign(canvas.style, { left: `${box.left - stage.left}px`, top: `${box.top - stage.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    follow();
    if (given) port.postMessage({ type: 'surface-size', size: sizeNow() });
  };
  const watch = new ResizeObserver(place);
  watch.observe(picture);
  // The plane moves the picture's viewBox in its frame; the paint moves with it before that frame is drawn.
  const moved = new MutationObserver(follow);
  moved.observe(picture, { attributes: true, attributeFilter: ['viewBox'] });
  return {
    canvas,
    /** Tell the drawing it has a surface, how big and in what colours: once. */
    give() {
      if (given) return;
      place();
      given = true;
      port.postMessage({ type: 'surface', size: sizeNow(), colours: colours() });
    },
    /** Show a frame the drawing painted: an image, and nothing else; `at`, the view it was painted at. */
    paint(image, at) {
      if (!(image instanceof ImageBitmap)) return;
      shown ??= canvas.getContext('bitmaprenderer');
      shown.transferFromImageBitmap(image);
      painted = viewOf(at);
      follow();
      firstSeen();
    },
    /** Settled once the first frame is shown. */
    first,
    end: () => (watch.disconnect(), moved.disconnect()),
  };
}

/**
 * What `host` showed before, laid over the picture drawn in its place until `surface` shows its first frame
 * (packs/surface/page/flow.css, .lf-was): else what its drawing paints is gone for a frame or more, a flicker on each
 * edit (e_m5x8pmwu). None without a surface, or with no picture before.
 */
export function heldOver(host, surface) {
  if (!surface || !host.querySelector('.lf-stage')) return null;
  const was = h('div', { class: 'lf-was', 'aria-hidden': 'true' }, ...host.childNodes);
  surface.first.then(() => was.remove());
  return was;
}
