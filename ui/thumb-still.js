// A drawn view as a still image (task e_qcydtzdj): the marks a drawing mounted, copied with the paint the page's
// stylesheets gave them written onto each, and the copy made an SVG image. An image runs nothing and loads nothing,
// so what is kept and shown later is only a picture. Text is left out, as the canvas leaves it at that size
// (`data-text` none); a picture the page lays out (HTML: a grid's cards, a list) is copied into the image whole.

const SVG = 'http://www.w3.org/2000/svg';
const XHTML = 'http://www.w3.org/1999/xhtml';

/** What the page paints a mark with, written onto its copy. */
const PAINT = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'color', 'transform', 'transform-origin', 'transform-box'];
/** What lays out and paints a box the page lays out, written onto its copy. */
const BOX = ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'margin', 'padding', 'border', 'border-radius', 'background-color', 'color', 'font', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'overflow', 'text-overflow', 'flex', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'left', 'top', 'right', 'bottom', 'opacity', 'vertical-align', 'list-style', 'fill', 'stroke', 'stroke-width'];

/** Each element of `from` paired with its copy in `to`, in the same order. */
const pairs = (from, to) => ((copies) => [from, ...from.querySelectorAll('*')].map((el, i) => [el, copies[i]]))([to, ...to.querySelectorAll('*')]);

/** The copy of `el` with the given properties of its computed style written on each element, and what is not drawn left out. */
function copied(el, props, leave) {
  const copy = el.cloneNode(true);
  const gone = [];
  for (const [a, b] of pairs(el, copy)) {
    const css = getComputedStyle(a);
    if (css.display === 'none' || leave(a)) {
      gone.push(b);
      continue;
    }
    b.removeAttribute('class');
    b.removeAttribute('style');
    // Through the style object, not the attribute: the page's policy refuses a style written as an attribute.
    for (const p of props) b.style.setProperty(p, css.getPropertyValue(p));
  }
  for (const b of gone) b.remove();
  return copy;
}

const asImage = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;

/**
 * The image painted small, `width` across at the screen's density: a PNG of a few kilobytes however much the picture
 * held. The SVG as it was where the browser will not paint it (a canvas it holds tainted).
 */
export async function smallOf(image, width) {
  try {
    const img = new Image();
    img.src = image;
    await img.decode();
    const scale = (width * devicePixelRatio) / img.naturalWidth;
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [Math.ceil(img.naturalWidth * Math.min(scale, 1)), Math.ceil(img.naturalHeight * Math.min(scale, 1))];
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return image;
  }
}

/** The picture drawn in `host` as an image's address, or null when it drew none. */
export function stillOf(host) {
  const stage = host.querySelector('.lf-stage');
  const picture = stage?.querySelector(':scope > svg');
  if (picture) {
    // The tier of text the canvas draws at this size, for a drawing's own stylesheet to read.
    stage.dataset.text = 'none';
    const copy = copied(picture, PAINT, (el) => el.localName === 'text' || el.localName === 'foreignObject');
    const [w, hgt] = [picture.getAttribute('width'), picture.getAttribute('height')];
    if (!copy.getAttribute('viewBox') && Number(w) > 0 && Number(hgt) > 0) copy.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    return copy.getAttribute('viewBox') ? asImage(copy) : null;
  }
  // A picture the page laid out: the view's own box, as wide and tall as what it holds.
  const laid = host.querySelector('.lens-view');
  const [w, hgt] = [laid?.scrollWidth, laid?.scrollHeight];
  if (!laid || !(w > 0) || !(hgt > 0)) return null;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  const room = document.createElementNS(SVG, 'foreignObject');
  for (const [k, v] of [['width', w], ['height', hgt]]) room.setAttribute(k, v);
  const box = copied(laid, BOX, (el) => el.localName === 'iframe' || el.localName === 'img' || el.matches('.toolbar, .lf-legend'));
  box.setAttribute('xmlns', XHTML);
  room.append(box);
  svg.append(room);
  return asImage(svg);
}
