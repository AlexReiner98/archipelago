// A note read as its reader meets it, as marks: titles, paragraphs, lists and checklists, quotes and callouts, code,
// tables, emphasis and links, in the dialect the item page and the published reader read (ui/text.js), kept to what a
// drawing may draw (HTML marks, docs/drawings.md). A line holding only an item's id is where that item comes in (a
// section): the caller says what to draw there. An id within a line leads to that item's page.

import { m } from './marks.js';

/** A line that brings an item in: its id and nothing else (src/documents.ts). */
export const SECTION = /^[ \t]*(e_[a-z0-9]{8})[ \t]*$/;

/** The words of one line, with **strong**, *emphasis*, `code`, [a link](to) as its words, and ids leading to their page. */
export function inline(text, titles) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\b(e_[a-z0-9]{8})\b/g;
  let at = 0;
  for (const hit of text.matchAll(re)) {
    if (hit.index > at) out.push(text.slice(at, hit.index));
    const [, strong, em, code, label, to, id] = hit;
    if (strong) out.push(m('strong', {}, strong));
    else if (em) out.push(m('em', {}, em));
    else if (code) out.push(m('span', { class: 'pg-code' }, code));
    else if (label) out.push(/^#\/e\/e_[a-z0-9]{8}$/.test(to) ? m('a', { href: to }, label) : m('span', { class: 'pg-link', title: to }, label));
    else out.push(m('a', { href: `#/e/${id}`, title: id }, titles.get(id) ?? id));
    at = hit.index + hit[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** What a note's lines say, as blocks: { title, level }, { para }, { list, ordered }, { quote }, { code }, { table }, { section }. */
export function blocks(body) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const id = SECTION.exec(line)?.[1];
    if (id) { out.push({ section: id }); continue; }
    if (/^```/.test(line)) {
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push({ code: code.join('\n') });
      continue;
    }
    const title = /^(#{1,6})\s+(.*)$/.exec(line);
    if (title) { out.push({ title: title[2].trim(), level: Math.min(title[1].length, 3) }); continue; }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) if (!/^\s*\|[\s:|-]+\|?\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      i--;
      out.push({ table: rows });
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
    if (item.test(line)) {
      const ordered = /\d/.test(item.exec(line)[1]);
      const list = [];
      for (; i < lines.length && item.test(lines[i]); i++) {
        const said = item.exec(lines[i])[2];
        const check = /^\[( |x|X)\]\s+(.*)$/.exec(said);
        list.push(check ? { text: check[2], done: check[1] !== ' ' } : { text: said });
      }
      i--;
      out.push({ list, ordered });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
      i--;
      // A callout says what it is first ([!note], [!warning]...): that is its look, not its words.
      const kind = /^\[!(\w+)\]\s*/.exec(quote[0] ?? '');
      if (kind) quote[0] = quote[0].slice(kind[0].length);
      out.push({ quote: quote.filter(Boolean).join(' '), kind: kind?.[1].toLowerCase() });
      continue;
    }
    const para = [line.trim()];
    while (i + 1 < lines.length && lines[i + 1].trim() && !SECTION.test(lines[i + 1]) && !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*>|\s*\|)/.test(lines[i + 1])) para.push(lines[++i].trim());
    out.push({ para: para.join(' ') });
  }
  return out;
}

/** The ids a note brings in, in order. */
export const sectionsOf = (body) => blocks(body).flatMap((b) => (b.section ? [b.section] : []));

/** Blocks as marks; `section(id)` draws the item a line brings in. */
export function render(list, titles, section) {
  return list.map((b) => {
    if (b.section) return section(b.section);
    if (b.title !== undefined) return m('div', { class: `pg-h pg-h${b.level}` }, ...inline(b.title, titles));
    if (b.code !== undefined) return m('div', { class: 'pg-pre' }, b.code);
    if (b.table) return m('div', { class: 'pg-table' }, b.table.map((row, r) => m('div', { class: `pg-row${r === 0 ? ' head' : ''}` }, row.map((cell) => m('span', {}, ...inline(cell, titles))))));
    if (b.list) return m(b.ordered ? 'ol' : 'ul', { class: 'pg-list' }, b.list.map((it) => m('li', { class: it.done === undefined ? undefined : it.done ? 'check done' : 'check' }, it.done !== undefined && m('span', { class: 'pg-box', 'aria-hidden': 'true' }, it.done ? '☑' : '☐'), ...inline(it.text, titles))));
    if (b.quote !== undefined) return m('div', { class: `pg-quote${b.kind ? ` ${b.kind}` : ''}` }, ...inline(b.quote, titles));
    return m('p', {}, ...inline(b.para, titles));
  });
}
