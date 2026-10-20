// A note as a page: its first paragraph and the titles of its sections, each one click away.

import { h, state } from './base.js';
import { idsAsLinks } from './words.js';

/**
 * A body as a page, not a block, and never a wall of text. Agents write notes
 * with headings (a line in capitals, or a short line of its own at the top of
 * a paragraph), numbered points and dashes; this draws them as headings and
 * lists at a readable width. A note opens as its first paragraph and the
 * titles of what else it holds: every section, and the rest of the opening,
 * is one click away.
 */
/**
 * A table, written as lines of | cells |, with a rule of dashes under its head (| --- | --: |): a colon on the right
 * of a rule's cell sets that column to the right, on both sides to the centre. A head with no words is not drawn.
 * Read from lines[at]; null when no table starts there.
 */
export const TABLE_ROW = /^\s*\|.*\|\s*$/;
export const TABLE_RULE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;
export function readTable(lines, at) {
  if (!TABLE_ROW.test(lines[at] ?? '') || !TABLE_RULE.test(lines[at + 1] ?? '')) return null;
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const aligns = cells(lines[at + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
  let end = at + 2;
  while (end < lines.length && TABLE_ROW.test(lines[end])) end++;
  return { end, head: cells(lines[at]), aligns, rows: lines.slice(at + 2, end).map(cells) };
}
/** A table read by readTable, each cell drawn by `cell`. */
export function drawTable(t, cell) {
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
 * How a note reads is its page's style (page.notes: folded, or whole as a document is read through) and how much of
 * it opens is the style's numbers (note_*): the house style says, a kind's or an item's may say otherwise. Without a
 * page's own, the workspace's.
 */
export function renderBody(text, { style = state.style } = {}) {
  const whole = style.page?.notes === 'whole';
  const n = (name) => {
    if (typeof style.numbers?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every number a note is read by`);
    return style.numbers[name];
  };
  const heading = (line) => /^[A-Z0-9][A-Z0-9 ,'()\/&-]{2,60}:?$/.test(line.trim()) && /[A-Z]{3}/.test(line);
  const item = (line) => /^\s*(-|\*|\d+\.|[A-Z]\.)\s+/.exec(line);
  const sections = [{ title: null, lines: [] }];
  const lines = text.split('\n');
  // A short line that opens a paragraph and does not end as a sentence is that paragraph's title.
  const titles = (line, i) => !lines[i - 1]?.trim() && Boolean(lines[i + 1]?.trim()) && line.trim().length <= n('note_title_most') && !/[.;,|]$/.test(line.trim()) && !item(line);
  for (const [i, line] of lines.entries()) {
    if (heading(line) || (line.trim() && titles(line, i))) sections.push({ title: line.trim().replace(/:$/, ''), lines: [] });
    else sections.at(-1).lines.push(line);
  }
  const blocks = (lines) => {
    const out = [];
    let list;
    let para = [];
    const flush = () => {
      if (para.length) out.push(h('p', {}, idsAsLinks(para.join(' '))));
      para = [];
    };
    // A cell said in **stars** is strong.
    const cell = (text) => (/^\*\*.*\*\*$/.test(text) ? h('strong', {}, idsAsLinks(text.slice(2, -2))) : idsAsLinks(text));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const table = readTable(lines, i);
      if (table) {
        flush();
        list = undefined;
        out.push(drawTable(table, cell));
        i = table.end - 1;
        continue;
      }
      const mark = item(line);
      if (mark) {
        flush();
        if (!list) out.push((list = h('ul', {})));
        list.append(h('li', {}, h('span', { class: 'muted' }, /^[-*]$/.test(mark[1]) ? '• ' : `${mark[1]} `), idsAsLinks(line.slice(mark[0].length))));
      } else if (!line.trim()) {
        flush();
        list = undefined;
      } else if (list && /^\s{2,}/.test(line)) {
        list.lastChild.append(...idsAsLinks(` ${line.trim()}`));
      } else {
        list = undefined;
        para.push(line.trim());
      }
    }
    flush();
    return out;
  };
  const sentence = (title) => (/[a-z]/.test(title) ? title : title.charAt(0) + title.slice(1).toLowerCase());
  // The opening is its first paragraph; what follows it before the first title is folded like a section.
  const opening = (lines) => {
    const [first, ...more] = blocks(lines);
    if (!first) return [];
    // A table that opens a note is shown whole: cut short, its cells would run together as words.
    if (first.tagName === 'TABLE') return [first, more.length > 0 && h('details', { class: 'section' }, h('summary', {}, 'More'), more)];
    // A first paragraph that is itself long is shown as its first sentences, and whole with the rest.
    const text = first.textContent;
    const long = text.length > n('note_opening_most') || first.tagName !== 'P';
    const sentence = new RegExp(`^.{${n('note_sentence_least')},${n('note_sentence_most')}}?[.:](?=\\s)`, 's');
    const start = long ? h('p', {}, `${(sentence.exec(text)?.[0] ?? text.slice(0, n('note_opening_cut'))).trim()} …`) : first;
    const rest = long ? [first, ...more] : more;
    return [start, rest.length > 0 && h('details', { class: 'section' }, h('summary', {}, 'More'), rest)];
  };
  const part = (sec) =>
    whole
      ? [sec.title && h('h4', { class: 'part-title' }, sentence(sec.title)), blocks(sec.lines)]
      : sec.title
        ? h('details', { class: 'section' }, h('summary', { title: sec.title }, sentence(sec.title)), blocks(sec.lines))
        : opening(sec.lines);
  return h(
    'div',
    { class: whole ? 'body-text whole' : 'body-text' },
    sections.filter((sec) => sec.title || sec.lines.some((l) => l.trim())).map(part),
  );
}
