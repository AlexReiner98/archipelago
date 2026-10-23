// What a drawing answers with, made into the page: marks (SVG and HTML as data) checked against what a drawing may
// say, and patches that change them later. A drawing's code is written by anyone who can change the map, so nothing
// it sends is trusted: only the tags and attributes listed here are made, a link goes only to an item's page, there
// is no script, no style attribute and no event handler, and its stylesheet is kept to its own host (cssFor).
//
// A mark is [tag, attributes, ...what is in it], a string being text. Two attributes are not drawn: `key`, the name
// a patch uses for it, and `on`, the events the drawing is told of (enter, leave, click).

const SVG = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'a', 'defs', 'clipPath', 'linearGradient', 'radialGradient', 'stop']);
const HTML_TAGS = new Set(['div', 'span', 'p', 'b', 'strong', 'em', 'i', 'small', 'ul', 'ol', 'li', 'br', 'a', 'button']);
const ATTRS = new Set(['class', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'width', 'height', 'viewBox', 'points', 'transform', 'text-anchor', 'dominant-baseline', 'pathLength', 'offset', 'preserveAspectRatio', 'role', 'aria-label', 'aria-hidden', 'title', 'hidden', 'href', 'stroke-dasharray', 'stroke-dashoffset', 'aria-live', 'opacity', 'fill-opacity', 'stroke-opacity', 'gradientUnits']);
/** The events a drawing may be told of, by the page's name for each; `seen` is told once, when the mark is first scrolled into sight. */
const EVENTS = { enter: 'mouseenter', leave: 'mouseleave', click: 'click', seen: 'seen' };
const seen = (el, fn) => {
  const sight = new IntersectionObserver((all) => all.some((e) => e.isIntersecting) && (sight.disconnect(), fn()), { threshold: 0.5 });
  sight.observe(el);
};
/** The one address a drawing may link to: an item's page. */
const ITEM = /^#\/e\/e_[a-z0-9]{8}$/;
/** The most marks one drawing may make: past it, the drawing is stopped. */
export const mostMarks = 60000;

const fail = (why) => {
  throw new Error(`The drawing sent what cannot be drawn: ${why}`);
};

function attribute(el, name, value) {
  if (!ATTRS.has(name)) fail(`the attribute "${name}"`);
  const text = String(value);
  if (name === 'href' && !ITEM.test(text)) fail(`a link to "${text.slice(0, 80)}"`);
  el.setAttribute(name, text);
}

/**
 * Make a mark, and those in it, into elements. `keys` collects each keyed element; `tell(key, name)` is called
 * when an event the mark listens for happens. `svg` is whether it is drawn inside an SVG.
 */
export function build(mark, keys, tell, svg = false, count = { n: 0 }) {
  if (typeof mark === 'string' || typeof mark === 'number') return document.createTextNode(String(mark));
  if (!Array.isArray(mark) || typeof mark[0] !== 'string') fail('a mark that is not [tag, attributes, ...]');
  if (++count.n > mostMarks) fail(`more than ${mostMarks} marks`);
  const [tag, attrs = {}, ...kids] = mark;
  const inSvg = svg || tag === 'svg';
  if (!(inSvg ? SVG_TAGS : HTML_TAGS).has(tag)) fail(`the tag "${tag}"`);
  const el = inSvg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (name === 'key') keys.set(String(value), el);
    else if (name === 'on') for (const e of Array.isArray(value) ? value : []) !EVENTS[e] ? fail(`the event "${e}"`) : e === 'seen' ? seen(el, () => tell(String(attrs.key), e)) : el.addEventListener(EVENTS[e], () => tell(String(attrs.key), e));
    else attribute(el, name, value);
  }
  if (attrs?.on && attrs.key === undefined) fail('an event on a mark with no key');
  for (const kid of kids) el.append(build(kid, keys, tell, inSvg, count));
  return el;
}

/** How a number in a path or a list moves: every number in it, from what it was to what it goes to. */
const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
const between = (from, to, t) => {
  const a = String(from).match(NUMBER), b = String(to).match(NUMBER);
  // Two values of a different shape cannot be moved between: it is the new one at the end.
  if (!a || !b || a.length !== b.length || String(from).replace(NUMBER, '#') !== String(to).replace(NUMBER, '#')) return t < 1 ? from : to;
  let n = 0;
  return String(to).replace(NUMBER, () => {
    const v = +a[n] + (+b[n] - +a[n]) * t;
    n++;
    return String(Math.round(v * 100) / 100);
  });
};
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/**
 * Change what is drawn, as a drawing asks: each patch names a mark by its key and says what of it changes:
 * `toggle` classes on or off, `set` attributes (null takes one away), `text` its words, `mark` it whole, `remove`
 * it, or `append` a mark into it. With `over` (milliseconds), what is set moves there instead of jumping.
 */
export function patch(list, keys, tell, moving) {
  for (const p of Array.isArray(list) ? list : []) {
    const el = keys.get(String(p?.key));
    if (!el) continue;
    for (const [name, on] of Object.entries(p.toggle ?? {})) el.classList.toggle(name, Boolean(on));
    if (p.text !== undefined) el.textContent = String(p.text);
    if (p.remove) (el.remove(), keys.delete(String(p.key)));
    if (p.mark) el.replaceWith(build(p.mark, keys, tell, el instanceof SVGElement && el.tagName !== 'svg'));
    if (p.append) el.append(build(p.append, keys, tell, el instanceof SVGElement));
    const set = Object.entries(p.set ?? {});
    const over = Number(p.over) > 0 ? Math.min(Number(p.over), 10000) : 0;
    for (const [name, value] of set) {
      for (const m of moving) if (m.el === el && m.name === name) moving.delete(m);
      if (value === null) {
        if (!ATTRS.has(name)) fail(`the attribute "${name}"`);
        el.removeAttribute(name);
      } else if (over) moving.add({ el, name, from: el.getAttribute(name) ?? value, to: String(value), t0: performance.now(), over });
      else attribute(el, name, value);
    }
  }
}

/** Move what is moving one frame on; whether anything still is. */
export function step(moving, now) {
  for (const m of moving) {
    const q = Math.min(1, (now - m.t0) / m.over);
    attribute(m.el, m.name, between(m.from, m.to, ease(q)));
    if (q >= 1) moving.delete(m);
  }
  return moving.size > 0;
}

/**
 * A drawing's stylesheet, kept to its own host: what it says is read only under `[data-drawing="<id>"]`, as rules
 * nested there (whose selectors weigh what they would alone), and the host's paint is contained (style.css), so
 * nothing it draws can cover the page. What could reach past the host, or out of the page, is refused.
 */
export function cssFor(id, text) {
  return `:where([data-drawing="${id}"]) {\n${checkedCss(text)}\n}`;
}

/**
 * A stylesheet as a drawing or a published page may say it, comments taken out: refused if it could fetch anything
 * or reach out of where it is read. A page's (`page`) may look at what a part holds (:has), which a drawing may not:
 * that is how a drawing would reach past its host.
 */
export function checkedCss(text, page = false) {
  const css = String(text ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  const refused = [/[\\"'&<]/, /@(import|font-face|namespace|property|keyframes|layer|page|scope|charset)/i, page ? /url\(|image-set\(|:host|:root|expression\(/i : /url\(|image-set\(|:has\(|:host|:root|expression\(/i, /(^|[{};,])\s*[~+>]/];
  const bad = refused.find((re) => re.test(css));
  if (bad) fail(`a stylesheet with ${bad}`);
  let depth = 0;
  for (const c of css) if ((depth += c === '{' ? 1 : c === '}' ? -1 : 0) < 0) fail('a stylesheet that closes more than it opens');
  if (depth) fail('a stylesheet that does not close what it opens');
  return css;
}
