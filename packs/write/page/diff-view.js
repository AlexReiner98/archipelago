// What a held change would do to code, as its line diff (task e_vc5tpunk): the server says each update of a field
// marked code as hunks against what the item holds now (packs/surface/kernel/code-diffs.ts), and this draws them: a
// line each in the code face, what is added and what is taken out marked, the hunk's place above it. Never wrapped:
// a line too long is cut, whole in its tip; the whole scrolls inside its box past a few screens.

import { h } from './base.js';

/** Its counts, as marks: +12 −3. */
export const diffCounts = (diffs) => `+${diffs.reduce((n, d) => n + (d.diff?.add ?? 0), 0)} −${diffs.reduce((n, d) => n + (d.diff?.del ?? 0), 0)}`;

/** The diffs of one or more ops, as rows of lines. */
export function diffView(diffs) {
  const rows = [];
  for (const { field, diff } of diffs) {
    if (!diff?.files) continue;
    const many = diffs.length > 1 || diff.files.length > 1;
    for (const f of diff.files) {
      if (many || f.file) rows.push(h('div', { class: 'ld-file' }, [field, f.file].filter(Boolean).join(' · '), f.was && ` (${f.was === 'added' ? 'new' : 'gone'})`, h('span', { class: 'ld-n' }, `+${f.add} −${f.del}`)));
      for (const hunk of f.hunks) {
        rows.push(h('div', { class: 'ld-hunk' }, `line ${hunk.b}`));
        for (const line of hunk.lines) {
          const m = line[0];
          rows.push(h('div', { class: `ld-line${m === '+' ? ' ld-add' : m === '-' ? ' ld-del' : ''}`, title: line.slice(1, 400) }, h('span', { class: 'ld-m' }, m === '+' ? '+' : m === '-' ? '−' : ' '), line.slice(1)));
        }
      }
    }
    if (diff.cut) rows.push(h('div', { class: 'ld-hunk' }, `${diff.cut} more lines not shown`));
  }
  return h('div', { class: 'line-diff' }, rows);
}
