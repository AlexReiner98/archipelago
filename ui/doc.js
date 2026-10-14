// A document given as a link, read by someone with no login: its text and the sections it brings in, in order.
// Nothing drawn that the server did not say, and every text set as text, never as markup. Made to be read whole and
// printed: the one place in Archipelago where a page is meant to be read through.

const main = document.getElementById('main');

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
  for (const [i, line] of lines.entries()) {
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
    } else if (!lines[i - 1]?.trim() && lines[i + 1]?.trim() && trimmed.length <= 90 && !/[.;,:!?]$/.test(trimmed)) {
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

function draw(d) {
  document.title = d.title;
  const titles = new Map(d.parts.filter((p) => p.section).map((p) => [p.section.id, p.section.title]));
  const sections = d.parts.filter((p) => p.section);
  // The page's parts, lists and all, laid out in one flat row as the page takes them.
  const kids = [
    h('header', {}, h('h1', {}, d.title), h('p', { class: 'muted' }, `Updated ${day(d.updated_at)}`)),
    sections.length > 2 && h('nav', { class: 'contents' }, h('ol', {}, sections.map((p) => h('li', {}, h('a', { href: `#${p.section.id}` }, p.section.title))))),
    d.parts.map((p) =>
      p.section
        ? h('section', { id: p.section.id }, h('h2', {}, p.section.title), blocks(p.section.body, titles, 3))
        : h('div', { class: 'text' }, blocks(p.text, titles, 2)),
    ),
    h('footer', { class: 'muted' }, h('button', { class: 'print', onclick: () => print() }, 'Print or save as PDF')),
  ];
  main.replaceChildren(...kids.flat(Infinity).filter(Boolean));
}

fetch(`${location.pathname.replace(/\/+$/, '')}/data`)
  .then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? 'This link does not open anything.');
    draw(body);
  })
  .catch((err) => main.replaceChildren(h('p', { class: 'error' }, err.message)));
