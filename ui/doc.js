// A document given as a link, read by someone with no login: its text and the sections it brings in, in order.
// Nothing drawn that the server did not say, and every text set as text, never as markup. Made to be read whole and
// printed: the one place in Archipelago where a page is meant to be read through.

const main = document.getElementById('main');
const here = location.pathname.replace(/\/+$/, '');
// Opened from the app (/read/<id>), the page reads the document with the reader's own sign-in; from a link (/s/...), with the link.
const own = /^\/read\/(e_[a-z0-9]{8})$/.exec(here)?.[1];
const token = () => {
  try {
    return localStorage.getItem('pelago-token') ?? '';
  } catch {
    return '';
  }
};
const api = async (tool, input) => {
  const res = await fetch(`/api/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token() && { authorization: `Bearer ${token()}` }) }, body: JSON.stringify(input) });
  const body = await res.json();
  if (!res.ok) throw new Error(res.status === 401 ? 'Sign in to Archipelago in this browser first, then open this again.' : body.error);
  return body.result;
};
/** A section's figure: from the link's own address, or fetched with the reader's sign-in. */
const figureSrc = (id) => (own ? '' : `${here}/picture/${id}`);

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

/** A line's words, with addresses on the web as links, **strong** as strong, and a section's id as a way to it. */
function inline(text, titles) {
  const out = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+[^\s).,;:])|\*\*([^*]+)\*\*|\b(e_[a-z0-9]{8})\b/g;
  let at = 0;
  for (const m of text.matchAll(pattern)) {
    out.push(text.slice(at, m.index));
    if (m[1]) out.push(h('a', { href: m[2], rel: 'noopener noreferrer', target: '_blank' }, m[1]));
    else if (m[3]) out.push(h('a', { href: m[3], rel: 'noopener noreferrer', target: '_blank' }, m[3].replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')));
    else if (m[4]) out.push(h('strong', {}, m[4]));
    else out.push(titles.has(m[5]) ? h('a', { href: `#${m[5]}` }, titles.get(m[5])) : '');
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return out;
}

/**
 * A table, written as lines of | cells |, with a rule of dashes under its head (| --- | --: |): a colon on the right
 * of a rule's cell sets that column to the right, on both sides to the centre. A head with no words is not drawn.
 * Read from lines[at]; null when no table starts there.
 */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;
function readTable(lines, at) {
  if (!TABLE_ROW.test(lines[at] ?? '') || !TABLE_RULE.test(lines[at + 1] ?? '')) return null;
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const aligns = cells(lines[at + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
  let end = at + 2;
  while (end < lines.length && TABLE_ROW.test(lines[end])) end++;
  return { end, head: cells(lines[at]), aligns, rows: lines.slice(at + 2, end).map(cells) };
}
/** A table read by readTable, each cell drawn by `cell`. */
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

/**
 * Text as blocks: "# " and "## " lines are headings; a short line on its own above a paragraph, not ending as a
 * sentence, is that paragraph's title (as notes on the map are written); "- ", "1. " lines are lists.
 */
function blocks(text, titles, depth) {
  const lines = text.split('\n');
  const out = [];
  let para = [];
  let list;
  const item = (line) => /^\s*(-|\*|\d+\.)\s+/.exec(line);
  const flush = () => {
    if (para.length) out.push(h('p', {}, inline(para.join(' '), titles)));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const table = readTable(lines, i);
    if (table) {
      flush();
      list = undefined;
      out.push(drawTable(table, (text) => inline(text, titles)));
      i = table.end - 1;
      continue;
    }
    const trimmed = line.trim();
    const mark = item(line);
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (!trimmed) {
      flush();
      list = undefined;
    } else if (heading) {
      flush();
      list = undefined;
      out.push(h(`h${Math.min(depth + heading[1].length - 1, 4)}`, {}, inline(heading[2], titles)));
    } else if (mark) {
      flush();
      const ordered = /\d/.test(mark[1]);
      if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) out.push((list = h(ordered ? 'ol' : 'ul', {})));
      list.append(h('li', {}, inline(line.slice(mark[0].length), titles)));
    } else if (list && /^\s{2,}/.test(line)) {
      list.lastChild.append(...inline(` ${trimmed}`, titles));
    } else if (!lines[i - 1]?.trim() && lines[i + 1]?.trim() && trimmed.length <= 90 && !/[.;,:!?|]$/.test(trimmed)) {
      flush();
      list = undefined;
      out.push(h(`h${Math.min(depth + 1, 4)}`, {}, inline(trimmed, titles)));
    } else {
      list = undefined;
      para.push(trimmed);
    }
  }
  flush();
  return out;
}

const INVOICE = 'time.invoice';
const money = (n, currency = 'CAD') => new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(Number(n) || 0);
const longDay = (ts) => new Date(`${ts}T12:00:00Z`).toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** An invoice's heading: its number, its dates and what is due, and a mark once it is paid. */
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

/** The page's colours and lengths: the workspace's style, light or dark as the reader's system is. Only plain hex colours and lengths. */
const dark = matchMedia('(prefers-color-scheme: dark)');
const LENGTH = /^\d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?( \d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?)*$/;
const asLength = (v) => (typeof v === 'number' && v >= 0 ? `${v}px` : typeof v === 'string' && LENGTH.test(v) ? v : null);
let look = {};
const paint = () => {
  const set = (name, value) => /^[a-z][a-z0-9_]*$/.test(name) && document.documentElement.style.setProperty(`--${name.replaceAll('_', '-')}`, value);
  for (const [name, colour] of Object.entries(look.theme?.[dark.matches ? 'dark' : 'light'] ?? {})) if (/^#[0-9a-f]{3,8}$/i.test(String(colour))) set(name, colour);
  for (const [name, value] of Object.entries(look.lengths ?? {})) if (asLength(value)) set(name, asLength(value));
};
dark.addEventListener('change', paint);

function draw(d) {
  look = d;
  paint();
  document.title = d.type === INVOICE && d.fields?.number ? `${d.fields.number} ${d.title.replace(/^Invoice [^:]*:\s*/, '')}` : d.title;
  const titles = new Map(d.parts.filter((p) => p.section).map((p) => [p.section.id, p.section.title]));
  const sections = d.parts.filter((p) => p.section);
  // The page's parts, lists and all, laid out in one flat row as the page takes them.
  const kids = [
    d.type === INVOICE ? invoiceHead(d) : h('header', {}, h('h1', {}, d.title), h('p', { class: 'muted' }, `Updated ${day(d.updated_at)}`)),
    sections.length > 2 && h('nav', { class: 'contents' }, h('ol', {}, sections.map((p) => h('li', {}, h('a', { href: `#${p.section.id}` }, p.section.title))))),
    d.parts.map((p) =>
      p.section
        ? h(
            'section',
            { id: p.section.id },
            h('h2', {}, p.section.title),
            p.section.picture && h('figure', {}, h('img', { src: figureSrc(p.section.id), alt: p.section.title, 'data-figure': p.section.id })),
            blocks(p.section.body, titles, 3),
          )
        : h('div', { class: 'text' }, blocks(p.text, titles, 2)),
    ),
    h('footer', { class: 'muted' }, h('button', { class: 'print', onclick: () => print() }, 'Print or save as PDF')),
  ];
  main.replaceChildren(...kids.flat(Infinity).filter(Boolean));
  document.body.classList.toggle('invoice', d.type === INVOICE);
  // Read with the reader's sign-in, a figure is fetched the same way.
  if (own) for (const img of main.querySelectorAll('img[data-figure]')) api('picture', { result: img.dataset.figure }).then((p) => p && (img.src = `data:${p.content_type};base64,${p.data}`), () => null);
}

(own
  ? Promise.all([api('document', { id: own }), api('view', { name: 'style', params: {} })]).then(([d, s]) => ({ ...d, theme: s.style.theme, lengths: s.style.lengths }))
  : fetch(`${here}/data`).then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'This link does not open anything.');
      return body;
    })
)
  .then(draw)
  .catch((err) => main.replaceChildren(h('p', { class: 'error' }, err.message)));
