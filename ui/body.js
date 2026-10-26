// A note as a page: its first paragraph and the titles of its sections, each one click away. What it says is read by
// the one dialect every page reads (ui/text.js); this draws it for the item page.

import { h, state } from './base.js';
import { readSpans, readText } from './text.js';
import { titles } from './words.js';

const NAME = /^[a-z][a-z0-9_]*$/;

/** A line's spans as the page draws them: an item it names is the way to that item's page, an address opens apart. */
export function drawSpans(text) {
  const draw = (spans) =>
    spans.map((s) => {
      if (s.t === 'text') return s.text;
      if (s.t === 'strong') return h('strong', {}, draw(s.spans));
      if (s.t === 'em') return h('em', {}, draw(s.spans));
      if (s.t === 'code') return h('code', { class: 'note-code' }, s.text);
      if (s.t === 'link') return h('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer', title: s.href }, s.text ?? s.href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
      return h('a', { href: `#/e/${s.id}`, class: 'note-item', title: titles.get(s.id) ?? 'Open it' }, s.text ?? titles.get(s.id) ?? 'this item');
    });
  return draw(readSpans(text));
}

/** A table read by ui/text.js, each cell drawn by `cell`. */
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
 * Blocks as elements. A callout takes its colour from the style (notes.callouts: a tone and the name of one of the
 * page's colours); a checklist item is ticked through `tick(line, done)` when the note may be changed here.
 */
function drawBlocks(blocks, { style, tick }) {
  // A cell said in **stars** is strong.
  const cell = (text) => (/^\*\*.*\*\*$/.test(text) ? h('strong', {}, drawSpans(text.slice(2, -2))) : drawSpans(text));
  return blocks.map((b) => {
    if (b.kind === 'para') return h('p', {}, drawSpans(b.text));
    if (b.kind === 'title') return h('h4', { class: 'part-title' }, drawSpans(sentence(b.text)));
    if (b.kind === 'table') return drawTable(b, cell);
    if (b.kind === 'code') return h('pre', { class: 'note-block' }, h('code', {}, b.text));
    if (b.kind === 'callout') {
      const box = h('aside', { class: b.tone ? 'callout' : 'callout quote' }, drawBlocks(b.blocks, { style, tick }));
      const colour = b.tone && style.notes?.callouts?.[b.tone];
      if (typeof colour === 'string' && NAME.test(colour)) {
        const name = colour.replaceAll('_', '-');
        box.style.setProperty('--callout', `var(--${name})`);
        box.style.setProperty('--callout-soft', `var(--${name}-soft, var(--panel))`);
      }
      return box;
    }
    return h(
      'ul',
      { class: b.items.some((it) => it.check !== null) ? 'checklist' : '' },
      b.items.map((it) =>
        it.check === null
          ? h('li', {}, h('span', { class: 'muted' }, b.ordered ? `${it.mark} ` : '• '), drawSpans(it.text))
          : h(
              'li',
              { class: it.check ? 'check done' : 'check' },
              h('input', { type: 'checkbox', checked: it.check, disabled: !tick, title: tick ? (it.check ? 'Not done' : 'Done') : '', onchange: (ev) => tick(it.line, ev.target.checked) }),
              h('span', {}, drawSpans(it.text)),
            ),
      ),
    );
  });
}

/** A title in capitals, said as a sentence. */
const sentence = (title) => (/[a-z]/.test(title) ? title : title.charAt(0) + title.slice(1).toLowerCase());

/**
 * A body as a page, not a block, and never a wall of text. A note opens as its first paragraph and the titles of what
 * else it holds: every section, and the rest of the opening, is one click away. How a note reads is its page's style
 * (page.notes: folded; open, each section open and still folded with a click; or whole, read through as a document
 * is) and how much of a folded note opens is the style's numbers
 * (note_*): the house style says, a kind's or an item's may say otherwise. Without a page's own, the workspace's.
 * `tick(line, done)`, where the note may be changed here, ticks a checklist item.
 */
export function renderBody(text, { style = state.style, tick } = {}) {
  const whole = style.page?.notes === 'whole';
  const open = style.page?.notes === 'open';
  const n = (name) => {
    if (typeof style.numbers?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every number a note is read by`);
    return style.numbers[name];
  };
  const sections = [{ title: null, blocks: [] }];
  for (const b of readText(text, { titleMost: n('note_title_most') })) {
    if (b.kind === 'title') sections.push({ title: b.text, blocks: [] });
    else sections.at(-1).blocks.push(b);
  }
  const blocks = (list) => drawBlocks(list, { style, tick });
  // The opening is its first paragraph; what follows it before the first title is folded like a section.
  const opening = (list) => {
    const [first, ...more] = blocks(list);
    if (!first) return [];
    if (open) return [first, ...more];
    // A table that opens a note is shown whole: cut short, its cells would run together as words.
    if (first.tagName === 'TABLE') return [first, more.length > 0 && h('details', { class: 'section' }, h('summary', {}, 'More'), more)];
    // A first paragraph that is itself long is shown as its first sentences, and whole with the rest.
    const said = first.textContent;
    const long = said.length > n('note_opening_most') || first.tagName !== 'P';
    const cut = new RegExp(`^.{${n('note_sentence_least')},${n('note_sentence_most')}}?[.:](?=\\s)`, 's');
    const start = long ? h('p', {}, `${(cut.exec(said)?.[0] ?? said.slice(0, n('note_opening_cut'))).trim()} …`) : first;
    const rest = long ? [first, ...more] : more;
    return [start, rest.length > 0 && h('details', { class: 'section' }, h('summary', {}, 'More'), rest)];
  };
  const part = (sec) =>
    whole
      ? [sec.title && h('h4', { class: 'part-title' }, drawSpans(sentence(sec.title))), blocks(sec.blocks)]
      : sec.title
        ? h('details', { class: 'section', open }, h('summary', { title: sec.title }, drawSpans(sentence(sec.title))), blocks(sec.blocks))
        : opening(sec.blocks);
  const page = h('div', { class: whole ? 'body-text whole' : 'body-text' }, sections.filter((sec) => sec.title || sec.blocks.length).map(part));
  // The width it is read at is one of the page's lengths, named by the style.
  const measure = style.notes?.measure;
  if (typeof measure === 'string' && NAME.test(measure)) page.style.setProperty('--note-measure', `var(--${measure.replaceAll('_', '-')})`);
  return page;
}
