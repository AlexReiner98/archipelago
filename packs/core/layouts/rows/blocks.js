// Layer: graph. An island's items as blocks: an item that is part of nothing shown heads one, and its parts (part_of)
// sit under it as an outline, each level indented, as iongraph indents a loop's body under its header. A head's own
// parts are split into columns, each no taller than the style allows (rows_column_most), so a big tree is not one tall
// list. A block moves as one: only its head is ranked. Pure: items and links in, blocks with their lines' heights out.

export const PART = 'part_of';

const byMade = (a, b) => (a.made < b.made ? -1 : a.made > b.made ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * What each item is part of, one whole each: the first part_of link it has to an item shown, unless that would close a
 * loop of parts (then the link is not a part here, and both stay blocks of their own or parts elsewhere).
 */
export function wholesOf(items, links) {
  const shown = new Map(items.map((i) => [i.id, i])), whole = new Map();
  const reaches = (from, to) => {
    for (let at = from, n = 0; at !== undefined && n <= shown.size; at = whole.get(at), n++) if (at === to) return true;
    return false;
  };
  const parts = links.filter((l) => l.type === PART && shown.has(l.from) && shown.has(l.to) && l.from !== l.to);
  parts.sort((p, q) => byMade(shown.get(p.from), shown.get(q.from)));
  for (const l of parts) if (!whole.has(l.from) && !reaches(l.to, l.from)) whole.set(l.from, l.to);
  return whole;
}

/**
 * The blocks of an island, made first. Each is { id (its head), head, made, members, columns, h, parent }: `columns` are
 * the head's parts split as the style says, each a list of lines { id, depth, y } (depth 0 is a part of the head, y
 * from the block's top), and `parent` says what each member is part of inside the block.
 */
export function blocksOf(items, links, z) {
  const shown = new Map(items.map((i) => [i.id, i])), whole = wholesOf(items, links), kids = new Map();
  for (const [part, of] of whole) (kids.get(of) ?? kids.set(of, []).get(of)).push(shown.get(part));
  for (const list of kids.values()) list.sort(byMade);
  const heads = items.filter((i) => !whole.has(i.id)).sort(byMade);
  /** A subtree as lines, each at its depth below `id`, stacked from 0: its own line, then its parts'. */
  const outline = (id, depth) => {
    const own = [{ id, depth, y: 0 }];
    let y = shown.get(id).h + z.line;
    for (const k of kids.get(id) ?? []) {
      const sub = outline(k.id, depth + 1);
      for (const line of sub.lines) own.push({ ...line, y: y + line.y });
      y += sub.h + z.line;
    }
    return { lines: own, h: y - z.line };
  };
  return heads.map((head) => {
    const top = head.h + z.line, columns = [];
    let column = null;
    for (const k of kids.get(head.id) ?? []) {
      const sub = outline(k.id, 0);
      if (!column || (column.h > 0 && column.h + z.line + sub.h > z.column_most)) columns.push((column = { lines: [], h: 0 }));
      const at = column.h > 0 ? column.h + z.line : 0;
      for (const line of sub.lines) column.lines.push({ ...line, y: top + at + line.y });
      column.h = at + sub.h;
    }
    const members = [head.id, ...columns.flatMap((c) => c.lines.map((l) => l.id))];
    const parent = new Map(members.filter((id) => whole.has(id)).map((id) => [id, whole.get(id)]));
    const h = columns.length ? top + Math.max(...columns.map((c) => c.h)) : head.h;
    return { id: head.id, head: head.id, made: head.made, members, columns, h, parent };
  });
}
