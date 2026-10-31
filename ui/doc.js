// A document given as a link or made public, read by someone with no login: its text and the sections it brings in, in order.
// Nothing drawn that the server did not say, and every text set as text, never as markup. Made to be read whole and
// printed: the one place in Archipelago where a page is meant to be read through.

import { drawFrozen } from './doc-lens.js';
import { warmDrawings } from './drawing.js';
import { checkedCss } from './marks.js';
import { readSpans, readText } from './text.js';
import { applyTheme } from './theme.js';
import { startTips } from './tip.js';

startTips();

const main = document.getElementById('main');
const here = location.pathname.replace(/\/+$/, '');
// Opened from the app (/read/<id>), the page reads the document with the reader's own sign-in; from a link (/s/...), with the link;
// made public (/p/<workspace>/<id>), as anyone. A preview (/preview/<id>) is drawn as the published page would be, from
// what publishing it would give now (src/published-preview.ts), read with the reader's sign-in.
const own = /^\/read\/(e_[a-z0-9]{8})$/.exec(here)?.[1];
const preview = /^\/preview\/e_[a-z0-9]{8}$/.test(here);
const published = here.startsWith('/p/');
const token = () => {
  try {
    return localStorage.getItem('pelago-token') ?? '';
  } catch {
    return '';
  }
};
const post = async (at, input) => {
  const res = await fetch(at, { method: 'POST', headers: { 'content-type': 'application/json', ...(token() && { authorization: `Bearer ${token()}` }) }, body: JSON.stringify(input) });
  const body = await res.json();
  if (!res.ok) throw new Error(res.status === 401 ? 'Sign in to Archipelago in this browser first, then open this again.' : body.error);
  return body.result;
};
const api = (tool, input) => post(`/api/${tool}`, input);
/** A section's figure: from the link's own address, or fetched with the reader's sign-in. */
const figureSrc = (id) => (own || preview ? '' : `${here}/picture/${id}`);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value == null) continue;
    if (key.startsWith('on')) el[key] = value;
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== false && kid != null && kid !== '') el.append(kid.nodeType ? kid : String(kid));
  return el;
}

const day = (ts) => new Date(ts).toLocaleDateString(undefined, { dateStyle: 'long' });

/** Other published documents a published one names, by id, with their titles: each is read at its own page beside this one. */
let away = new Map();
// On a site's own domain a published page is read at its address word, the front page at /.
let paths = {};
let onSite = false;
const pageOf = (id) => (own ? `/read/${id}` : onSite && paths[id] ? (paths[id] === 'home' ? '/' : `/${paths[id]}`) : here.replace(/[^/]+$/, id));
/** Where a link to a page of the site by its address (/quickstart, / for the front page) leads: there on the site's own domain, else to that page as it is read here, or nowhere when it is not published. */
const pathTo = (path) => {
  if (onSite) return path;
  const id = Object.keys(paths).find((k) => (paths[k] === 'home' ? '/' : `/${paths[k]}`) === path);
  return id ? pageOf(id) : null;
};

/** A line's words, read in the one dialect (ui/text.js): addresses on the web as links, a section's or another published document's id or address as a way to it. */
function inline(text, titles) {
  const draw = (spans) =>
    spans.map((s) => {
      if (s.t === 'text') return s.text;
      if (s.t === 'strong') return h('strong', {}, draw(s.spans));
      if (s.t === 'em') return h('em', {}, draw(s.spans));
      if (s.t === 'code') return h('code', {}, s.text);
      if (s.t === 'link') return h('a', { href: s.href, rel: 'noopener noreferrer', target: '_blank' }, s.text ?? s.href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
      if (s.t === 'page') return pathTo(s.path) ? h('a', { href: pathTo(s.path) }, s.text) : s.text;
      return titles.has(s.id) ? h('a', { href: `#${s.id}` }, s.text ?? titles.get(s.id)) : away.has(s.id) ? h('a', { href: pageOf(s.id) }, s.text ?? away.get(s.id)) : (s.text ?? '');
    });
  return draw(readSpans(text));
}

/** A table read by ui/text.js, each cell drawn by `cell`. */
function drawTable(t, cell) {
  // The page's policy allows no inline style: a column's side is a class.
  const td = (tag, text, i) => h(tag, { class: `align-${t.aligns[i] ?? 'left'}` }, cell(text));
  return h(
    'table',
    { class: 'text-table' },
    t.head.some(Boolean) && h('thead', {}, h('tr', {}, t.head.map((c, i) => td('th', c, i)))),
    h('tbody', {}, t.rows.map((row) => h('tr', {}, t.aligns.map((_, i) => td('td', row[i] ?? '', i))))),
  );
}

/** Text as blocks, read in the one dialect (ui/text.js): a title is a heading at `depth`, deeper for each further #. */
function blocks(text, titles, depth) {
  const draw = (list) =>
    list.map((b) => {
      if (b.kind === 'para') return h('p', {}, inline(b.text, titles));
      if (b.kind === 'title') return h(`h${Math.min(depth + (b.level || 2) - 1, 4)}`, {}, inline(b.text, titles));
      if (b.kind === 'table') return drawTable(b, (text) => inline(text, titles));
      if (b.kind === 'code') return h('pre', {}, h('code', {}, b.text));
      if (b.kind === 'callout') return h('aside', { class: b.tone ? `callout ${b.tone}` : 'callout quote' }, draw(b.blocks));
      if (b.items.some((it) => it.check !== null)) return h('ul', { class: 'checklist' }, b.items.map((it) => h('li', { class: it.check ? 'done' : '' }, h('span', { class: 'tick' }, it.check ? '☑ ' : '☐ '), inline(it.text, titles))));
      return h(b.ordered ? 'ol' : 'ul', {}, b.items.map((it) => h('li', {}, inline(it.text, titles))));
    });
  return draw(readText(text));
}

/** The site's header: its name, a way home, and its main pages, the one open marked. */
function siteHead(site) {
  const at = (href) => href && (href === location.pathname || (href !== '/' && location.pathname.startsWith(`${href}/`)));
  return h(
    'nav',
    { class: 'site-head' },
    h('a', { class: 'site-name', href: site.home ?? undefined }, site.name),
    h('span', { class: 'site-pages' }, site.pages.map((page) => h('a', { href: page.href, 'aria-current': at(page.href) ? 'page' : undefined }, page.title))),
  );
}

const money = (n, currency = 'CAD') => new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(Number(n) || 0);
const longDay = (ts) => new Date(`${ts}T12:00:00Z`).toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** An invoice's heading, for a document whose style gives its page that head (page.head): its number, its dates and what is due, and a mark once it is paid. */
function invoiceHead(d) {
  const f = d.fields ?? {};
  const owing = Number(f.total ?? 0) - Number(f.paid ?? 0);
  return h(
    'header',
    { class: 'invoice-head' },
    h('div', {}, h('h1', {}, 'Invoice'), h('p', { class: 'muted' }, f.number ?? d.title)),
    h(
      'dl',
      { class: 'invoice-facts' },
      f.issued && [h('dt', {}, 'Issued'), h('dd', {}, longDay(f.issued))],
      f.due && [h('dt', {}, 'Due'), h('dd', {}, longDay(f.due))],
      f.paid > 0 && owing > 0 && [h('dt', {}, 'Paid'), h('dd', {}, money(f.paid))],
      [h('dt', {}, owing > 0 || !f.paid ? 'Total due' : 'Total'), h('dd', { class: 'invoice-total' }, money(owing > 0 || !f.paid ? owing || f.total : f.total))],
    ),
    d.status === 'paid' && h('span', { class: 'stamp' }, 'Paid'),
    d.status === 'void' && h('span', { class: 'stamp void' }, 'Void'),
  );
}


/** The address word of a site's front page (src/site.ts). */
const FRONT = 'home';

// How the workspace's style says a published page looks (page_css): read after the page's own rules, only in it.
const pageSheet = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];
const pageCss = (css) => {
  try {
    return css ? [':where(body) {', checkedCss(css, true), '}'].join('\n') : '';
  } catch (err) {
    console.warn(err.message);
    return '';
  }
};

function draw(d) {
  applyTheme(d);
  pageSheet.replaceSync(pageCss(d.page_css));
  document.title = d.head === 'invoice' && d.fields?.number ? `${d.fields.number} ${d.title.replace(/^Invoice [^:]*:\s*/, '')}` : d.title;
  const titles = new Map(d.parts.filter((p) => p.section).map((p) => [p.section.id, p.section.title]));
  away = new Map(Object.entries(d.links ?? {}));
  paths = d.paths ?? {};
  onSite = Boolean(d.site?.host);
  // The section the style names for a link's picture (page.share) is shown where a link is posted, not on the page.
  const sections = d.parts.filter((p) => p.section && p.section.id !== d.share);
  // A page is one column (ui/doc-lens.css). Only a front page whose first section is a figure leaves it: that figure runs from edge to edge, with no title over it (its title is its words).
  const hero = d.parts.find((p) => p.section)?.section;
  const lead = d.path === FRONT && hero?.picture && !d.lenses?.[hero.id] ? hero.id : null;
  const part = (p) =>
    p.section
      ? h(
          'section',
          { id: p.section.id, ...(p.section.id === lead && { class: 'lead' }) },
          p.section.id !== lead && h('h2', {}, p.section.title),
          // A lens is its picture, drawn from what was frozen when it was published (or, for a draft read with a sign-in, now); otherwise a section shows its figure.
          d.lenses?.[p.section.id]
            ? h('div', { class: 'doc-lens', 'data-lens': p.section.id })
            : p.section.picture && h('figure', {}, h('img', { src: figureSrc(p.section.id), alt: p.section.title, 'data-figure': p.section.id, 'data-via': p.section.via })),
          blocks(p.section.body, titles, 3),
        )
      : h('div', { class: 'text' }, blocks(p.text, titles, 2));
  // A picture that plays stands beside its words, in a band of the page: the words are what the text before it says
  // under its last title, or all of it. Everything else keeps to the column.
  const plays = (p) => Boolean(p?.section && d.lenses?.[p.section.id]?.steps);
  const parts = () => {
    const list = d.parts.filter((p) => !p.section || p.section.id !== d.share), out = [];
    for (let k = 0; k < list.length; k++) {
      const el = part(list[k]);
      if (list[k].section || !plays(list[k + 1])) {
        out.push(el);
        continue;
      }
      const lines = [...el.children], from = Math.max(lines.findLastIndex((line) => line.tagName === 'H3'), 0);
      const words = h('div', { class: 'text band-words' }, lines.slice(from));
      const pictures = [];
      while (plays(list[k + 1])) pictures.push(part(list[++k]));
      if (from) out.push(el);
      out.push(h('div', { class: 'doc-band' }, words, h('div', { class: 'band-pictures' }, pictures)));
    }
    return out;
  };
  // The page's parts, lists and all, laid out in one flat row as the page takes them.
  const kids = [
    d.site && siteHead(d.site),
    d.head === 'invoice' ? invoiceHead(d) : h('header', {}, h('h1', {}, d.title), h('p', { class: 'muted' }, d.published_at ? `Published ${day(d.published_at)}` : `Updated ${day(d.updated_at)}`)),
    parts(),
    // A site's pages each end with what its footer page says (src/site.ts).
    d.site?.footer && h('footer', { class: 'site-foot' }, blocks(d.site.footer, titles, 3)),
    // A published page is read on the web: only a link's or an invoice's has a way to print it.
    !published && !d.site && h('footer', { class: 'muted' }, h('button', { class: 'print', onclick: () => print() }, 'Print or save as PDF')),
  ];
  main.replaceChildren(...kids.flat(Infinity).filter(Boolean));
  document.body.classList.toggle('invoice', d.head === 'invoice');
  // Its pictures, with the text: a drawing's first frame is kept with the picture, and the drawing takes it over once started.
  for (const el of main.querySelectorAll('[data-lens]')) drawFrozen(el, d.lenses[el.dataset.lens], d.types);
  // Read with the reader's sign-in, a figure is fetched the same way.
  if (own || preview) for (const img of main.querySelectorAll('img[data-figure]')) (img.dataset.via ? api('share_figure', { via: img.dataset.via, id: img.dataset.figure }) : api('picture', { result: img.dataset.figure })).then((p) => p && (img.src = `data:${p.content_type};base64,${p.data}`), () => null);
}

// A published page carries its data (src/published-page.ts); a link's and a signed-in reader's page fetch it, and
// start the frame drawings run in while it is on its way (ui/drawing.js).
const given = document.getElementById('page-data');
if (!given) warmDrawings();
(given
  ? Promise.resolve(JSON.parse(given.textContent))
  : preview
  ? post(`${here}/data`, {})
  : own
  ? Promise.all([api('document', { id: own, drawn: true }), api('view', { name: 'style', params: { of: own } })]).then(([d, { style: s }]) => ({ ...d, theme: s.theme, lengths: s.lengths, faces: s.faces, type: s.type, head: s.page?.head, share: s.page?.share }))
  : fetch(`${here}/data`).then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'This link does not open anything.');
      return body;
    })
)
  .then(draw)
  .catch((err) => main.replaceChildren(h('p', { class: 'error' }, err.message)));

// Opened with ?live, a published page is drawn anew each time its document is published again (src/published-live.ts).
if (given && new URLSearchParams(location.search).has('live'))
  new EventSource(`${here}/live`).addEventListener('published', () => fetch(`${here}/data`).then((res) => res.json()).then(draw, () => null));
