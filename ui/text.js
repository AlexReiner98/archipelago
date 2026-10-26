// The one dialect a note is written in, read the same way wherever it is read (Rule 11): the item page (ui/body.js),
// the published reader (ui/doc.js) and anyone's test of it. Text in, blocks and spans out, as data: each page draws
// them with its own elements, and never as markup.
//
// The dialect is markdown as agents and people write it on the map:
//   # Title, ## Title, ### Title       a title; so is a line in capitals, or a short line of its own above a paragraph
//   - point, * point, 1. point, A. point
//   - [ ] to do, - [x] done            a checklist: ticking one is a change to the note
//   > words, > [!NOTE] words           a callout (NOTE, TIP, IMPORTANT, WARNING, CAUTION), or a quote
//   | a | b | over | --- | --: |       a table
//   ``` ... ```                        code, as it is written
//   **strong**, *said so*, `code`, [name](https://...), [name](e_xxxxxxxx), an address, an item's id

/** A table, written as lines of | cells |, with a rule of dashes under its head (| --- | --: |). */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;
const ITEM = /^\s*(-|\*|\d+\.|[A-Z]\.)\s+/;
const CHECK = /^\[( |x|X)\]\s+/;
const HASH = /^(#{1,4})\s+(.*)$/;
const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;
const FENCE = /^\s*```/;

/** A table read from lines[at], or null when none starts there: its head, the side each column is set to, its rows. */
export function readTable(lines, at) {
  if (!TABLE_ROW.test(lines[at] ?? '') || !TABLE_RULE.test(lines[at + 1] ?? '')) return null;
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const aligns = cells(lines[at + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
  let end = at + 2;
  while (end < lines.length && TABLE_ROW.test(lines[end])) end++;
  return { end, head: cells(lines[at]), aligns, rows: lines.slice(at + 2, end).map(cells) };
}

/** Whether a line is in capitals, as agents write a title. */
const capitals = (line) => /^[A-Z0-9][A-Z0-9 ,'()\/&-]{2,60}:?$/.test(line.trim()) && /[A-Z]{3}/.test(line);

/**
 * Text as blocks, in order: { kind: 'title', level (1 to 4 for #, 0 for a title written as agents do), text, line },
 * { kind: 'para', text }, { kind: 'list', ordered, items: [{ mark, text, check (null, or whether it is ticked), line }] },
 * { kind: 'table', head, aligns, rows }, { kind: 'callout', tone (note, tip, important, warning, caution; null for a
 * quote), blocks }, { kind: 'code', text }. `line` is where it stands in the text, from 0. A short line of its own
 * above a paragraph is a title when it is at most `titleMost` long and does not end as a sentence.
 */
export function readText(text, { titleMost = 90, from = 0 } = {}) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  let para = [];
  let list;
  const flush = () => {
    if (para.length) out.push({ kind: 'para', text: para.join(' ') });
    para = [];
  };
  const end = () => (flush(), (list = undefined));
  const plain = (line) => !ITEM.test(line) && !/^\s*>/.test(line) && !FENCE.test(line) && !TABLE_ROW.test(line) && !HASH.test(line.trim());
  const titled = (line, i) => !lines[i - 1]?.trim() && Boolean(lines[i + 1]?.trim()) && line.trim().length <= titleMost && !/[.;,|!?]$/.test(line.trim()) && plain(line);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (FENCE.test(line)) {
      end();
      let close = i + 1;
      while (close < lines.length && !FENCE.test(lines[close])) close++;
      out.push({ kind: 'code', text: lines.slice(i + 1, close).join('\n') });
      i = close;
      continue;
    }
    const table = readTable(lines, i);
    if (table) {
      end();
      out.push({ kind: 'table', head: table.head, aligns: table.aligns, rows: table.rows });
      i = table.end - 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      end();
      let last = i;
      while (last + 1 < lines.length && /^\s*>/.test(lines[last + 1])) last++;
      const inner = lines.slice(i, last + 1).map((l) => l.replace(/^\s*>\s?/, ''));
      const tone = CALLOUT.exec(inner[0])?.[1].toLowerCase() ?? null;
      if (tone) inner[0] = inner[0].replace(CALLOUT, '');
      out.push({ kind: 'callout', tone, blocks: readText(inner.join('\n'), { titleMost, from: from + i }) });
      i = last;
      continue;
    }
    const hash = HASH.exec(trimmed);
    const mark = ITEM.exec(line);
    if (!trimmed) end();
    else if (hash) {
      end();
      out.push({ kind: 'title', level: hash[1].length, text: hash[2].trim(), line: from + i });
    } else if (mark) {
      flush();
      const ordered = !/^[-*]$/.test(mark[1]);
      if (!list || list.ordered !== ordered) out.push((list = { kind: 'list', ordered, items: [] }));
      const rest = line.slice(mark[0].length);
      const check = CHECK.exec(rest);
      list.items.push({ mark: mark[1], text: check ? rest.slice(check[0].length) : rest, check: check ? check[1] !== ' ' : null, line: from + i });
    } else if (list && /^\s{2,}/.test(line)) {
      list.items.at(-1).text += ` ${trimmed}`;
    } else if (capitals(line) || titled(line, i)) {
      end();
      out.push({ kind: 'title', level: 0, text: trimmed.replace(/:$/, ''), line: from + i });
    } else {
      list = undefined;
      para.push(trimmed);
    }
  }
  flush();
  return out;
}

/** The line a checklist item stands on, ticked or not: what a tick changes in the note. */
export function ticked(text, line, done) {
  const lines = String(text).split('\n');
  const at = lines[line];
  if (at === undefined || !ITEM.test(at)) return null;
  const mark = ITEM.exec(at)[0];
  if (!CHECK.test(at.slice(mark.length))) return null;
  return { was: at, now: `${mark}[${done ? 'x' : ' '}]${at.slice(mark.length + 3)}` };
}

const SPANS = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|\[([^\]]+)\]\((https?:\/\/[^)\s]+|e_[a-z0-9]{8})\)|(https?:\/\/[^\s)]+[^\s).,;:])|\b(e_[a-z0-9]{8})\b/g;

/**
 * A line's words as spans: { t: 'text', text }, { t: 'strong', spans }, { t: 'em', spans }, { t: 'code', text },
 * { t: 'link', href, text } (an address on the web; text null when the address is all there is), and
 * { t: 'item', id, text } (an item named by its id; text null when only its id is written).
 */
export function readSpans(text) {
  const out = [];
  let at = 0;
  const str = String(text ?? '');
  for (const m of str.matchAll(SPANS)) {
    if (m.index > at) out.push({ t: 'text', text: str.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ t: 'code', text: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'strong', spans: readSpans(m[2]) });
    else if (m[3] !== undefined) out.push({ t: 'em', spans: readSpans(m[3]) });
    else if (m[4] !== undefined) out.push(m[5].startsWith('e_') ? { t: 'item', id: m[5], text: m[4] } : { t: 'link', href: m[5], text: m[4] });
    else if (m[6] !== undefined) out.push({ t: 'link', href: m[6], text: null });
    else out.push({ t: 'item', id: m[7], text: null });
    at = m.index + m[0].length;
  }
  if (at < str.length) out.push({ t: 'text', text: str.slice(at) });
  return out;
}

/** The words of spans, as they read. */
export const spanText = (spans) => spans.map((s) => (s.spans ? spanText(s.spans) : (s.text ?? s.href ?? s.id))).join('');
