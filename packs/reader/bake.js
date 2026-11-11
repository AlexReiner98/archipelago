// A public view baked as one page (task e_4c8u53gw): its rails picture, run by the server (src/public-bake.ts, the act
// public.baked), written as HTML a reader walks by scrolling (public/rails.js) and a search engine or a reader with no
// script reads whole: each stop's title and note as text in order, the map as SVG, its stops as a list. Pure: what the
// kernel answered in, the page out. Nothing is read here but that answer, so what was not frozen is not on the page.
//
// The page has a band above the walk (header.lead): the place for what is put above the rails (task e_4m657w2v).

/** The tags and attributes a mark may have, as the page holds a drawing to them (ui/marks.js); anything else is refused. */
const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'a', 'defs', 'clipPath', 'linearGradient', 'radialGradient', 'stop']);
const ATTRS = new Set(['class', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'width', 'height', 'viewBox', 'points', 'transform', 'text-anchor', 'dominant-baseline', 'pathLength', 'offset', 'preserveAspectRatio', 'role', 'aria-label', 'aria-hidden', 'title', 'hidden', 'href', 'stroke-dasharray', 'stroke-dashoffset', 'aria-live', 'opacity', 'fill-opacity', 'stroke-opacity', 'gradientUnits']);
const ID = /^e_[a-z0-9]{8}$/;
const ITEM = /^#\/e\/(e_[a-z0-9]{8})$/;
const MOST = 60000;

export const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const refuse = (why) => {
  throw new Error(`The picture holds what cannot be baked: ${why}`);
};

/**
 * A drawing's marks as SVG text. A link to an item's page leads to its stop on this page instead (#s-<id>); `item`
 * is said as data-item, which rails.js lights; `key`, `on` and `pulse` are the live page's and left out.
 */
export function svgOf(mark, count = { n: 0 }) {
  if (typeof mark === 'string' || typeof mark === 'number') return escape(mark);
  if (!Array.isArray(mark) || typeof mark[0] !== 'string') refuse('a mark that is not [tag, attributes, ...]');
  if (++count.n > MOST) refuse(`more than ${MOST} marks`);
  const [tag, attrs = {}, ...kids] = mark;
  if (!SVG_TAGS.has(tag)) refuse(`the tag "${tag}"`);
  const said = [];
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (name === 'key' || name === 'on' || name === 'pulse' || value === null || value === undefined || value === false) continue;
    const text = String(value);
    if (name === 'item') {
      if (!ID.test(text)) refuse(`the item "${text.slice(0, 80)}"`);
      said.push(['data-item', text]);
    } else if (name === 'href') {
      const to = ITEM.exec(text);
      if (!to) refuse(`a link to "${text.slice(0, 80)}"`);
      said.push(['href', `#s-${to[1]}`]);
      if (!('item' in attrs)) said.push(['data-item', to[1]]);
    } else if (ATTRS.has(name)) said.push([name, text]);
    else refuse(`the attribute "${name}"`);
  }
  if (tag === 'svg' && count.n === 1) said.push(['xmlns', 'http://www.w3.org/2000/svg']);
  return `<${tag}${said.map(([n, v]) => ` ${n}="${escape(v)}"`).join('')}>${kids.map((k) => svgOf(k, count)).join('')}</${tag}>`;
}

/** The style's colours, sizes, numbers and font as --ln-* variables, held to what a style may say (ui/query-base.js dress). */
const COLORS = ['sea', 'land', 'inner', 'line', 'text', 'muted', 'accent', 'blocked', 'you', 'session', 'done', 'warn'];
const TOP = ['text', 'radius', 'gap', 'column'];
const LENGTH = /^\d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?( \d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?)*$/;
const NAME = /^[a-z][a-z0-9_]*$/;
const lengthOf = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? `${v}px` : typeof v === 'string' && LENGTH.test(v) ? v : null);
const dashed = (name) => name.replaceAll('_', '-');

export function varsOf(style = {}) {
  const set = [];
  for (const name of COLORS) if (typeof style.colors?.[name] === 'string' && /^#[0-9a-f]{3,8}$/i.test(style.colors[name])) set.push([`--ln-${name}`, style.colors[name]]);
  for (const name of TOP) if (lengthOf(style[name])) set.push([`--ln-${name}-size`, lengthOf(style[name])]);
  for (const [name, value] of Object.entries(style.sizes ?? {})) if (NAME.test(name) && lengthOf(value)) set.push([`--ln-${dashed(name)}`, lengthOf(value)]);
  for (const [name, value] of Object.entries(style.numbers ?? {})) if (NAME.test(name) && Number.isFinite(value)) set.push([`--ln-${dashed(name)}`, String(value)]);
  if (typeof style.font === 'string' && !/[;{}<>\\]/.test(style.font)) set.push(['--ln-font', style.font]);
  return set;
}

const FACE = /^[A-Za-z0-9 ,'"-]+$/;
const TRACK = /^-?\d+(\.\d+)?em$/;
const HEX = /^#[0-9a-f]{3,8}$/i;

/** The page's look as the app paints it (ui/theme.js): each colour of a scheme, and with the light, each length, face and text role. */
export function themeOf(look = {}, scheme = 'light') {
  const out = [];
  for (const [name, colour] of Object.entries(look.theme?.[scheme] ?? {})) if (NAME.test(name) && HEX.test(String(colour))) out.push([`--${dashed(name)}`, colour]);
  if (scheme !== 'light') return out;
  for (const [name, value] of Object.entries(look.lengths ?? {})) if (NAME.test(name) && lengthOf(value)) out.push([`--${dashed(name)}`, lengthOf(value)]);
  const face = (name) => (NAME.test(String(name)) && typeof look.faces?.[name] === 'string' && FACE.test(look.faces[name]) ? `var(--face-${dashed(String(name))})` : 'var(--face-text)');
  for (const [name, value] of Object.entries(look.faces ?? {})) if (NAME.test(name) && typeof value === 'string' && FACE.test(value)) out.push([`--face-${dashed(name)}`, value]);
  for (const [role, t] of Object.entries(look.type ?? {})) {
    if (!NAME.test(role) || !t || typeof t !== 'object') continue;
    const at = `--type-${dashed(role)}`;
    out.push([`${at}-family`, face(t.face)], [`${at}-weight`, [400, 600].includes(t.weight) ? String(t.weight) : '400'], [`${at}-style`, t.style === 'italic' ? 'italic' : 'normal']);
    out.push([`${at}-case`, t.case === 'upper' ? 'uppercase' : 'none'], [`${at}-track`, typeof t.track === 'string' && TRACK.test(t.track) ? t.track : '0']);
  }
  return out;
}

const block = (selector, vars) => `${selector} {\n${vars.map(([n, v]) => `  ${n}: ${v};`).join('\n')}\n}`;

/**
 * The page's own stylesheet: the page's look (`look`, the public view's theme, lengths, faces and type) in the reader's
 * scheme, the style's values, and the drawing's sheet (checked by the kernel) kept to the rails.
 */
export function lookCss(baked, look = {}) {
  return `${[
    block(':root', [...themeOf(look, 'light'), ...varsOf(baked.style)]),
    `@media (prefers-color-scheme: dark) {\n${block(':root', themeOf(look, 'dark'))}\n}`,
    `.rails {\n${baked.scene.css ?? ''}\n}`,
  ].join('\n')}\n`;
}

/** The stops as an agent is handed them: in order, each with its words and its own address. */
export const stopsOf = (baked, origin = '') =>
  baked.scene.stops.map((s) => ({ id: s.id, title: s.title, note: s.note, href: `${origin}/${s.id}` }));

/** The stop a page is opened at, by its id, or undefined. */
export const stopOf = (baked, id) => baked.scene.stops.find((s) => s.id === id);

const at = (c) => `${c.x} ${c.y} ${c.span}`;

/**
 * The page. `head` is what goes in its head beyond the title (description, canonical, the preview card), `title` its
 * title, `site` the header and footer (name, footer, home), `start` the main button's address, `look` the stylesheet's
 * address, `stop` the stop it opens at, `ref` the tag the reader came by, which its counts carry.
 */
export function bakedPage(baked, doc, { title, head = '', site = {}, start, look, stop, ref }) {
  const { scene } = baked;
  const stops = scene.stops
    .map((s) => `<li class="rails-stop" id="s-${s.id}" data-item="${s.id}" data-at="${at(s)}"><div class="rails-card"><h2>${escape(s.title)}</h2>${s.note ? `<p>${escape(s.note)}</p>` : ''}</div></li>`)
    .join('\n');
  const footer = site.footer ? `<footer class="site-foot">${site.footer.split(/\n[ \t]*\n/).map((p) => `<p>${escape(p.trim())}</p>`).join('')}</footer>` : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(title)}</title>
    ${head}
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="stylesheet" href="/layout.css" />
    <link rel="stylesheet" href="/flow.css" />
    <link rel="stylesheet" href="/rails.css" />
    <link rel="stylesheet" href="/baked.css" />
    <link rel="stylesheet" href="${escape(look)}" />
  </head>
  <body class="baked">
    <nav class="site-head"><a class="site-name" href="/">${escape(site.name ?? '')}</a>${start ? `<a class="start" href="${escape(start)}">Start hosted</a>` : ''}</nav>
    <main id="main">
      <header class="lead"><h1>${escape(doc.title)}</h1></header>
      <section class="rails" data-whole="${at(scene.whole)}"${stop ? ` data-start="${stop.id}"` : ''}${ref ? ` data-ref="${escape(ref)}"` : ''}>
        <div class="rails-stage">${svgOf(scene.svg)}</div>
        <ol class="rails-stops">
${stops}
        </ol>
      </section>
    </main>
    ${footer}
    <script type="module" src="/rails.js"></script>
    <script type="module" src="/baked.js"></script>
  </body>
</html>
`;
}
