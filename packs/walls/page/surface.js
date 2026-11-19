// A surface: a layer the page lays under a drawing's picture when its scene asks for one (`surface: { key }`), for
// pixels the drawing paints in its worker, in the sandbox, as a layout's code paints (three.js is offered to it
// there). The drawing paints on canvases of its own in the worker and sends finished frames as images; the page shows
// them here. Nothing but pixels crosses: what comes is checked to be an image, with the place it was painted for as
// numbers, and nothing of the page goes back but the surface's size and the page's colours. It lies exactly under the
// picture, so the picture's marks stand on its paint; it takes no pointer, and is shown or hidden by the drawing's own
// classes (its key, like any mark's). The drawing is told of it only when it asks, so a picture that never paints in
// it costs nothing.
//
// One world, one camera: the page's. Every image is a tile of the picture, laid at the place in the picture's own
// units it was painted for (`rect`), on a layer that takes the very transform the plane gives the picture's marks
// (its viewBox), in the same frame. So a pan or a zoom moves paint and marks as one, without asking the drawing, and
// a tile painted for one part of the picture can never stand anywhere else: there is no camera of the drawing's to
// fall behind. A drawing that paints what the screen sees sends one tile, the view it was painted at.

import { h } from './base.js';

/** A place in the picture's units ({ x, y, width, height }): numbers, a size above nothing; or none. */
export const rectOf = (r) => {
  const v = r && [r.x, r.y, r.width, r.height].map(Number);
  return v && v.every(Number.isFinite) && v[2] > 0 && v[3] > 0 ? { x: v[0], y: v[1], width: v[2], height: v[3] } : null;
};

/**
 * How the picture's units land on a box `wide` by `tall` pixels seen through `view` ({ x, y, width, height }), as an
 * SVG's viewBox lays them (centred, the whole view in sight): a CSS transform for a layer whose own units are the
 * picture's, from its corner.
 */
export function cameraOf(view, wide, tall) {
  if (!view || !(wide > 0) || !(tall > 0)) return '';
  const k = Math.min(wide / view.width, tall / view.height);
  const ox = (wide - view.width * k) / 2 - view.x * k, oy = (tall - view.height * k) / 2 - view.y * k;
  return `translate(${ox}px, ${oy}px) scale(${k})`;
}

/** A surface under `picture`, spoken of over `port`; `colours()` is how the page is coloured when the drawing asks. */
export function surfaceOf(picture, port, colours) {
  const layer = h('div', { class: 'lf-surface', 'aria-hidden': 'true' });
  const tiles = new Map();
  let given = false, firstSeen, box = { width: 0, height: 0 };
  const first = new Promise((r) => (firstSeen = r));
  const sizeNow = () => ({ width: box.width, height: box.height, dpr: Math.min(devicePixelRatio || 1, 2) });
  // Where the camera stands now: the picture's viewBox as the plane set it, else the picture's own size.
  const camera = () => {
    const b = picture.viewBox?.baseVal;
    if (b && b.width > 0 && b.height > 0) return { x: b.x, y: b.y, width: b.width, height: b.height };
    const w = Number(picture.getAttribute?.('width')) || box.width, t = Number(picture.getAttribute?.('height')) || box.height;
    return w > 0 && t > 0 ? { x: 0, y: 0, width: w, height: t } : null;
  };
  const follow = () => {
    layer.style.transform = cameraOf(camera(), box.width, box.height);
  };
  // Under the picture, wherever the stage puts it: its corner, from the stage's.
  const place = () => {
    const b = picture.getBoundingClientRect(), stage = layer.parentElement?.getBoundingClientRect();
    box = { width: b.width, height: b.height };
    if (stage) Object.assign(layer.style, { left: `${b.left - stage.left}px`, top: `${b.top - stage.top}px` });
    follow();
    if (given) port.postMessage({ type: 'surface-size', size: sizeNow() });
  };
  const watch = new ResizeObserver(place);
  watch.observe(picture);
  // The plane moves the picture's viewBox in its frame; the layer takes the same move before that frame is drawn.
  const moved = new MutationObserver(follow);
  moved.observe(picture, { attributes: true, attributeFilter: ['viewBox', 'width', 'height'] });
  /** One tile shown: its image on a canvas of its own, laid at its place. The first of a key comes over those before it. */
  const lay = (key, image, rect) => {
    let t = tiles.get(key);
    if (!t) {
      const canvas = h('canvas', { class: 'lf-tile' });
      t = { canvas, shown: canvas.getContext('bitmaprenderer'), at: '' };
      tiles.set(key, t);
      layer.append(canvas);
    }
    t.shown.transferFromImageBitmap(image);
    const at = `${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
    if (at !== t.at) (t.at = at), Object.assign(t.canvas.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  return {
    canvas: layer,
    /** Tell the drawing it has a surface, how big and in what colours: once. */
    give() {
      if (given) return;
      place();
      given = true;
      port.postMessage({ type: 'surface', size: sizeNow(), colours: colours() });
    },
    /**
     * Show what the drawing painted: tiles ([{ key, image, rect }], each laid at its place in the picture), or one image
     * painted at view `at` ({ x, y, width }), laid over that view. Images and numbers, and nothing else.
     */
    paint(image, at, list) {
      if (Array.isArray(list)) {
        for (const t of list.slice(0, 64)) {
          const rect = rectOf(t?.rect);
          if (t?.image instanceof ImageBitmap && rect) lay(String(t.key ?? '').slice(0, 64), t.image, rect);
        }
      } else if (image instanceof ImageBitmap) {
        const w = Number(at?.width);
        const rect = rectOf(at && { x: at.x, y: at.y, width: w, height: (w * image.height) / Math.max(1, image.width) });
        const view = camera();
        lay('', image, rect ?? (view && { ...view, height: (view.width * image.height) / Math.max(1, image.width) }) ?? { x: 0, y: 0, width: box.width || 1, height: box.height || 1 });
      } else return;
      firstSeen();
    },
    /** Settled once the first frame is shown. */
    first,
    end: () => (watch.disconnect(), moved.disconnect()),
  };
}
