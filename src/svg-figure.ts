// A figure kept as SVG: a drawing baked from its shapes, sharp at any width. It is read only as an image (an <img>,
// served with nothing allowed), and kept only when it is drawing alone: shapes, fills, strokes and text, with no
// script, no style sheet, no link and nothing it would fetch. Anything else is refused, never cleaned. It may move:
// an <animate> fades a part in or out, or takes it in or out of the drawing, on a clock, and nothing else (no event
// starts it, and it reaches no address).

const TIME = /^\d+(\.\d+)?m?s$/;
/** What <animate> may say, each checked by its value. */
const ANIMATE: Record<string, (value: string) => boolean> = {
  attributeName: (v) => v === 'opacity' || v === 'display',
  calcMode: (v) => v === 'discrete',
  begin: (v) => TIME.test(v),
  dur: (v) => TIME.test(v),
  fill: (v) => v === 'freeze',
  values: (v) => /^([\d.]+|inline|none)(;([\d.]+|inline|none))*$/.test(v),
};
const ELEMENTS = new Set(['animate', 'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'defs', 'clipPath', 'linearGradient', 'radialGradient', 'stop']);
const ATTRIBUTES = new Set([
  'xmlns', 'version', 'viewBox', 'preserveAspectRatio', 'width', 'height', 'id', 'transform', 'opacity', 'display', 'clip-path', 'clipPathUnits',
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'points', 'dx', 'dy',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linejoin', 'stroke-linecap', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod',
]);

/** Why an SVG may not be kept as a figure, or null when it is drawing alone. */
export function svgRefused(text: string): string | null {
  const body = text.replace(/^﻿?\s*<\?xml\s[^?]*\?>/, '');
  if (!/^\s*<svg[\s>]/.test(body)) return 'it does not begin with <svg>';
  if (/<[!?]/.test(body)) return 'it holds a declaration, a comment or an instruction (<! or <?)';
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
  const attribute = /\s+([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let at = body.indexOf('<'); at >= 0; at = body.indexOf('<', tag.lastIndex)) {
    tag.lastIndex = at;
    const m = tag.exec(body);
    if (!m) return `a tag it cannot read at ${at}`;
    if (!ELEMENTS.has(m[2])) return `<${m[2]}> is not drawing`;
    if (m[2] === 'animate' && !m[1] && !/\sattributeName\s*=/.test(m[3])) return '<animate> names no attribute';
    for (const [, name, double, single] of m[3].matchAll(attribute)) {
      const value = double ?? single;
      if (m[2] === 'animate') {
        if (!ANIMATE[name]?.(value)) return `${name} on <animate> may not say that`;
        continue;
      }
      if (!ATTRIBUTES.has(name)) return `${name} on <${m[2]}> is not drawing`;
      // A paint or a clip may name a gradient or a clip in the picture itself, and nothing outside it.
      if (/url\s*\(/i.test(value) && !/^\s*url\(\s*#[\w-]+\s*\)\s*$/.test(value)) return `${name} on <${m[2]}> reaches outside the picture`;
      if (name === 'xmlns' && value !== 'http://www.w3.org/2000/svg') return `xmlns names ${value}`;
    }
  }
  return null;
}
