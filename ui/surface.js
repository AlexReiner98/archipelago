// A surface: a canvas the page lays over a drawing's picture when its scene asks for one (`surface: { key }`), for
// pixels the drawing paints in its worker, in the sandbox, as a style's own code paints (three.js is offered to it
// there). The drawing paints on a canvas of its own in the worker and sends each finished frame as an image; the page
// shows it here. Nothing but pixels crosses: what comes is checked to be an image, and nothing of the page goes back
// but the surface's size and the page's colours. It lies exactly over the picture, takes no pointer, and is shown or
// hidden by the drawing's own classes (its key, like any mark's). The drawing is told of it only when it asks, so a
// picture that never paints in it costs nothing.

import { h } from './base.js';

/** A surface over `picture`, spoken of over `port`; `colours()` is how the page is coloured when the drawing asks. */
export function surfaceOf(picture, port, colours) {
  const canvas = h('canvas', { class: 'lf-surface', 'aria-hidden': 'true' });
  let given = false, shown = null, firstSeen;
  const first = new Promise((r) => (firstSeen = r));
  const sizeNow = () => {
    const box = picture.getBoundingClientRect();
    return { width: box.width, height: box.height, dpr: Math.min(devicePixelRatio || 1, 2) };
  };
  // Over the picture, wherever the stage puts it: its box, from the stage's corner.
  const place = () => {
    const box = picture.getBoundingClientRect(), stage = canvas.parentElement?.getBoundingClientRect();
    if (!stage) return;
    Object.assign(canvas.style, { left: `${box.left - stage.left}px`, top: `${box.top - stage.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    if (given) port.postMessage({ type: 'surface-size', size: sizeNow() });
  };
  const watch = new ResizeObserver(place);
  watch.observe(picture);
  return {
    canvas,
    /** Tell the drawing it has a surface, how big and in what colours: once. */
    give() {
      if (given) return;
      place();
      given = true;
      port.postMessage({ type: 'surface', size: sizeNow(), colours: colours() });
    },
    /** Show a frame the drawing painted: an image, and nothing else. */
    paint(image) {
      if (!(image instanceof ImageBitmap)) return;
      shown ??= canvas.getContext('bitmaprenderer');
      shown.transferFromImageBitmap(image);
      firstSeen();
    },
    /** Settled once the first frame is shown. */
    first,
    end: () => watch.disconnect(),
  };
}
