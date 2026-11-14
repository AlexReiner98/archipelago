// A change to code in an item's history, as its line diff (task e_vc5tpunk): the server says it as hunks
// (packs/surface/kernel/line-diff.ts), and the page draws them folded under the change's line, each line one row in the
// code face, added and taken out marked by tone, never wrapped (what does not fit is cut, whole in its tip).

/** Its counts in a few marks' words: +12 −3. */
export const counts = (diffs) => {
  const add = diffs.reduce((n, d) => n + (d.diff?.add ?? 0), 0), del = diffs.reduce((n, d) => n + (d.diff?.del ?? 0), 0);
  return `+${add} −${del}`;
};

/** Spaces kept as they are written (indents, comments lined up): a row of text does not keep them otherwise, and it never wraps. */
const indent = (s) => s.replace(/\t/g, '  ').replace(/ /g, ' ');

/** One line of a hunk as a row: its mark, then the line. */
const lineMark = (line) => {
  const m = line[0], text = line.slice(1);
  return ['text', { look: 'code', ...(m === '+' ? { tone: 'ok' } : m === '-' ? { tone: 'bad' } : {}), tip: text.slice(0, 200) }, `${m === '+' ? '+' : m === '-' ? '−' : ' '} ${indent(text)}`];
};

/** The diffs of one change, as rows: each module's name and counts where there are several or it has a name, each hunk where it starts. */
export function diffMarks(diffs) {
  const rows = [];
  for (const { field, diff } of diffs) {
    if (!diff?.files) continue;
    const many = diffs.length > 1 || diff.files.length > 1;
    for (const f of diff.files) {
      if (many || f.file) rows.push(['text', { look: 'muted', bold: true }, `${[field, f.file].filter(Boolean).join(' · ')}${f.was ? ` (${f.was === 'added' ? 'new' : 'gone'})` : ''}  +${f.add} −${f.del}`]);
      for (const h of f.hunks) rows.push(['text', { look: 'code', tone: 'muted' }, `line ${h.b}`], ...h.lines.map(lineMark));
    }
    if (diff.cut) rows.push(['text', { look: 'muted' }, `${diff.cut} more lines not shown`]);
  }
  return ['box', { flow: 'column', gap: 0, pad: 1 }, ...rows];
}
