// A layout run as a page's backdrop (packs/walls/page/backdrop.js), the frame's side: what the page says of itself,
// checked, and the frames of code that says where on the page it drew them, shown there. Not a module: written in front
// of draw.js (packs/surface/kernel/ui-files.ts), as draw-record.js is.
'use strict';

/** What the page around a backdrop says, made numbers and at most 256 boxes: its size, scroll, window, a box for each block of its words, its call to action's (focus) and the margin it asks drawn above and below the window, or that it is out of sight; and whether its reader asks for less motion. */
function pageOf(said) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  if (!said || typeof said !== 'object') return null;
  const reducedMotion = said.reducedMotion === true;
  if (said.visible === false) return { visible: false, reducedMotion };
  const box = (b) => ({ x: n(b?.x), y: n(b?.y), w: Math.max(0, n(b?.w)), h: Math.max(0, n(b?.h)) });
  return { visible: true, reducedMotion, width: n(said.width), height: n(said.height), scroll: n(said.scroll), margin: Math.max(0, n(said.margin)), view: { width: n(said.view?.width), height: n(said.view?.height) }, clear: Array.isArray(said.clear) ? said.clear.slice(0, 256).map(box) : [], focus: said.focus && typeof said.focus === 'object' ? box(said.focus) : null };
}

/** What a backdrop's code tells its page of its look (look() in its worker): only these names, each a hex colour, nothing else (the page checks it again: packs/walls/page/backdrop.js). */
function lookSaid(said) {
  const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  if (!said || typeof said !== 'object') return {};
  return Object.fromEntries(['ink', 'light', 'land', 'water', 'accent'].filter((k) => typeof said[k] === 'string' && hex.test(said[k])).map((k) => [k, said[k]]));
}

/**
 * A backdrop that scrolls with its page. Code that says after each frame where on the page its canvas's top stands
 * (drawn(top), in its worker) hands that frame here as a picture; it is shown on a canvas of its own, at that height,
 * in a frame the page makes as tall as itself and scrolls with its words. Between frames the land then moves with the
 * words exactly, by the browser's own scrolling, never a frame behind; a new frame and its place change together.
 * `away()` puts the canvas the code was handed out of sight once the first picture comes. Answers show(frame), for
 * each picture, and placed(top), when the page says it scrolls the frame and where the frame's top stands on it.
 */
function landing(away) {
  let land, paint, at = 0, top = null;
  const put = () => land && top !== null && (land.style.transform = `translateY(${at - top}px)`);
  return {
    show({ bitmap, top: y }) {
      if (!land) {
        land = document.createElement('canvas');
        land.className = 'land';
        land.hidden = true;
        // As wide as the frame, as tall as the picture makes it: the window and the margin above and below it.
        Object.assign(land.style, { position: 'absolute', left: '0', top: '0', height: 'auto' });
        paint = land.getContext('bitmaprenderer');
        document.body.append(land);
        away();
        parent.postMessage({ type: 'scrolls' }, '*');
      }
      if (land.width !== bitmap.width || land.height !== bitmap.height) Object.assign(land, { width: bitmap.width, height: bitmap.height });
      paint.transferFromImageBitmap(bitmap);
      at = y;
      put();
    },
    end: () => land?.remove(),
    placed(y) {
      top = Number.isFinite(y) ? y : 0;
      if (land) land.hidden = false;
      put();
    },
  };
}
