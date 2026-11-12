// A part's paint surface: a plane in its own units (width by height) holding paths and placed text, seen through a
// frame that pans and zooms it on the page (ui/pan-zoom.js), never by asking the part. With `pixels`, a canvas of the
// plane's size lies under the paths, for whoever hosts the part to hand it over to paint on (an OffscreenCanvas in the
// part's worker); it moves with the plane, so what is painted there stays under what is drawn over it.

import { panZoom } from './pan-zoom.js';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Make a paint surface for `node`. `drawn(mark)` makes one mark on the plane (ui/part-render.js). Answers with its
 * element, the pixel canvas when it has one, `update(node)` with a new answer, and `stop()`.
 */
export function paintSurface(node, { style, drawn }) {
  const el = Object.assign(document.createElement('div'), { className: 'pm-paint' });
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'pm-plane');
  let pixels = null;
  let { width, height } = node.at;
  if (node.at.pixels) {
    pixels = Object.assign(document.createElement('canvas'), { className: 'pm-pixels', width, height });
    el.append(pixels);
  }
  el.append(svg);
  // The canvas is the plane at one unit a pixel, carried as the plane is: where the frame looks, at its scale.
  const follow = (v) => pixels && (pixels.style.transform = `scale(${v.scale}) translate(${-v.x}px, ${-v.y}px)`);
  const fill = (n) => svg.replaceChildren(...n.kids.map(drawn));
  const sized = (n) => el.style.setProperty('--pm-aspect', `${n.at.width} / ${n.at.height}`);
  sized(node);
  fill(node);
  let moves = panZoom(el, svg, { width, height, start: node.at.start, style, told: follow });
  return {
    el,
    pixels,
    update(next) {
      fill(next);
      // A plane of another size is framed again; one of the same size stays where the reader left it.
      if (next.at.width === width && next.at.height === height) return;
      ({ width, height } = next.at);
      sized(next);
      if (pixels) Object.assign(pixels, { width, height });
      moves.stop();
      moves = panZoom(el, svg, { width, height, start: next.at.start, style, told: follow });
    },
    stop: () => moves.stop(),
  };
}
