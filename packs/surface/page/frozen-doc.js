// A document's page drawn from the marks its part made as it was published (./frozen-page.js), in the page's own
// elements: a header with its h1, each section a <section> with its h2 and its picture (a .doc-lens, or a figure), the
// words as paragraphs, headings, tables, code and lists, the site's nav.site-head and footer.site-foot. A published
// page's stylesheet (its style's page_css) is written against these, so a page reads as it did before its words came
// as marks (decision e_rhz4dvpk). The marks decide what is on the page and in what order; this only names it.
// Every mark was checked first (./part-check.js), and every text is set as text, never as markup.

import { h } from './base.js';
import { readSpans, readText } from './text.js';

/** The address word of a site's front page (packs/publish/kernel/site.ts). */
const FRONT = 'home';
const SECTION = /^s:(e_[a-z0-9]{8})$/;

/** A control that copies code, in line with it, saying so until the pointer or the focus leaves; where the browser refuses, the code is selected to copy by hand. */
function copyButton(text, code) {
  const again = (e) => (e.currentTarget.classList.remove('copied'), (e.currentTarget.title = 'Copy'));
  return h('button', {
    class: 'copy',
    type: 'button',
    title: 'Copy',
    'aria-label': 'Copy',
    onpointerleave: again,
    onblur: again,
    onclick: (e) => {
      const button = e.currentTarget;
      (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(() => (button.classList.add('copied'), (button.title = 'Copied')), () => getSelection()?.selectAllChildren(code));
    },
  });
}
const inlineCode = (text) => {
  const code = h('code', {}, text);
  return h('span', { class: 'code-line' }, code, copyButton(text, code));
};
const codeBlock = (text) => {
  const code = h('code', {}, text);
  return h('div', { class: 'code-block' }, h('pre', {}, code), copyButton(text, code));
};

/**
 * What the words of a page need to know to lead somewhere: its sections by id (`titles`), the other published pages it
 * names (`away`), and where a page by id or by address word is read (`pageOf`, `pathTo`).
 */
export function waysOf(d, { own, here }) {
  const paths = d.paths ?? {};
  const onSite = Boolean(d.site?.host);
  const pageOf = (id) => (own ? `/read/${id}` : onSite && paths[id] ? (paths[id] === FRONT ? '/' : `/${paths[id]}`) : here.replace(/[^/]+$/, id));
  const pathTo = (path) => {
    if (onSite) return path;
    const id = Object.keys(paths).find((k) => (paths[k] === FRONT ? '/' : `/${paths[k]}`) === path);
    return id ? pageOf(id) : null;
  };
  const titles = new Map((d.parts ?? []).filter((p) => p.section).map((p) => [p.section.id, p.section.title]));
  return { titles, away: new Map(Object.entries(d.links ?? {})), pageOf, pathTo };
}

/** A line's words in the one dialect: addresses on the web as links, a section's or another published page's id or address as a way to it. */
function inline(text, ways) {
  const draw = (spans) =>
    spans.map((s) => {
      if (s.t === 'text') return s.text;
      if (s.t === 'strong') return h('strong', {}, draw(s.spans));
      if (s.t === 'em') return h('em', {}, draw(s.spans));
      if (s.t === 'code') return inlineCode(s.text);
      if (s.t === 'link') return h('a', { href: s.href, rel: 'noopener noreferrer', target: '_blank' }, s.text ?? s.href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
      if (s.t === 'page') return ways.pathTo(s.path) ? h('a', { href: ways.pathTo(s.path) }, s.text) : s.text;
      if (ways.titles.has(s.id)) return h('a', { href: `#${s.id}` }, s.text ?? ways.titles.get(s.id));
      return ways.away.has(s.id) ? h('a', { href: ways.pageOf(s.id) }, s.text ?? ways.away.get(s.id)) : (s.text ?? '');
    });
  return draw(readSpans(text));
}

function drawTable(t, cell) {
  // The page's policy allows no inline style: a column's side is a class.
  const td = (tag, text, i) => h(tag, { class: `align-${t.aligns[i] ?? 'left'}` }, cell(text));
  return h('table', { class: 'text-table' }, t.head.some(Boolean) && h('thead', {}, h('tr', {}, t.head.map((c, i) => td('th', c, i)))), h('tbody', {}, t.rows.map((row) => h('tr', {}, t.aligns.map((_, i) => td('td', row[i] ?? '', i))))));
}

/** Words as blocks: a title is a heading at `depth`, deeper for each further #. */
export function blocks(text, ways, depth) {
  const draw = (list) =>
    list.map((b) => {
      if (b.kind === 'para') return h('p', {}, inline(b.text, ways));
      if (b.kind === 'title') return h(`h${Math.min(depth + (b.level || 2) - 1, 4)}`, {}, inline(b.text, ways));
      if (b.kind === 'table') return drawTable(b, (t) => inline(t, ways));
      if (b.kind === 'code') return codeBlock(b.text);
      if (b.kind === 'callout') return h('aside', { class: b.tone ? `callout ${b.tone}` : 'callout quote' }, draw(b.blocks));
      if (b.items.some((it) => it.check !== null)) return h('ul', { class: 'checklist' }, b.items.map((it) => h('li', { class: it.check ? 'done' : '' }, h('span', { class: 'tick' }, it.check ? '☑ ' : '☐ '), inline(it.text, ways))));
      return h(b.ordered ? 'ol' : 'ul', {}, b.items.map((it) => h('li', {}, inline(it.text, ways))));
    });
  return draw(readText(text));
}

/** A checked mark's kind, attributes and what it holds. */
const kindOf = (n) => n?.mark;
const kids = (n) => n?.kids ?? [];
const said = (n) => String(n?.words ?? '');
const looksAs = (n, look) => n?.mark === 'text' && n.at?.look === look;

/** An invoice's head, from its marks: its title and number, its facts, and its stamp. */
function invoiceHead(node) {
  const [names, facts, stamp] = kids(node);
  const [title, number] = kids(names);
  return h(
    'header',
    { class: 'invoice-head' },
    h('div', {}, h('h1', {}, said(title)), h('p', { class: 'muted' }, said(number))),
    h('dl', { class: 'invoice-facts' }, kids(facts).map((row) => { const [k, v] = kids(row); return [h('dt', {}, said(k)), h('dd', v?.at?.bold ? { class: 'invoice-total' } : {}, said(v))]; })),
    stamp && h('span', { class: stamp.at?.tone === 'bad' ? 'stamp void' : 'stamp' }, said(stamp)),
  );
}

/** The page's head: its title and when it was published, or an invoice's. */
function headOf(node) {
  if (kindOf(node) === 'text') return h('header', {}, h('h1', {}, said(node)));
  if (node.at?.flow === 'row') return invoiceHead(node);
  const [title, when] = kids(node);
  return h('header', {}, h('h1', {}, said(title)), when && h('p', { class: 'muted' }, said(when)));
}

/**
 * The page's parts from its marks, in order: words, sections and the bands a playing picture stands in. `picture(id)`
 * gives a section's picture holder (a .doc-lens or a figure), filled once the page is in place.
 */
export function pageParts(root, d, ways, picture) {
  const lead = (s) => d.path === FRONT && d.parts?.find((p) => p.section)?.section?.id === s && d.parts.find((p) => p.section).section.picture && !d.lenses?.[s];
  const section = (node) => {
    const id = SECTION.exec(node.key ?? '')?.[1];
    return h(
      'section',
      { id, ...(lead(id) && { class: 'lead' }) },
      kids(node).map((k) => (looksAs(k, 'title') ? h('h2', {}, said(k)) : kindOf(k) === 'picture' ? picture(k.item) : kindOf(k) === 'note' ? blocks(said(k), ways, 3) : null)),
    );
  };
  const words = (node) => h('div', { class: 'text' }, blocks(said(node), ways, 2));
  const part = (node) => {
    if (kindOf(node) === 'note') return words(node);
    if (SECTION.test(node.key ?? '')) return section(node);
    // A band: the words before a picture that plays, under their last title, beside the pictures.
    if (/^band:/.test(node.key ?? '')) {
      const [left, right] = kids(node);
      const el = words(kids(left)[0]);
      const lines = [...el.children], from = Math.max(lines.findLastIndex((line) => line.tagName === 'H3'), 0);
      return [from > 0 && el, h('div', { class: 'doc-band' }, h('div', { class: 'text band-words' }, lines.slice(from)), h('div', { class: 'band-pictures' }, kids(right).map(section)))];
    }
    return null;
  };
  const [head, ...rest] = kindOf(root) === 'box' ? kids(root) : [root];
  return [headOf(head), ...rest.map(part)];
}

/** The site's header: its name, a way home, and its main pages, the one open marked. */
export function siteHead(site) {
  const at = (href) => href && (href === location.pathname || (href !== '/' && location.pathname.startsWith(`${href}/`)));
  return h('nav', { class: 'site-head' }, h('a', { class: 'site-name', href: site.home ?? undefined }, site.name), h('span', { class: 'site-pages' }, site.pages.map((page) => h('a', { href: page.href, 'aria-current': at(page.href) ? 'page' : undefined }, page.title))));
}
