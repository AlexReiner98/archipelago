/**
 * What the Document view reads, top to bottom: pure, rows and links in, an
 * outline out, so the page and the tests read it alike.
 *
 * - The sections are the ids a view names (`document.sections`), in that
 *   order; without them, the items a query found that are part of none of
 *   the others, in the order found.
 * - Under each item, what is `part_of` it, at any depth, each once.
 * - Siblings keep the order found, except where one `depends_on` another:
 *   then the one it depends on comes first.
 * - What is closed and not work (a superseded record, a retired note) is
 *   left out, with what is under it: a document reads what holds now. Work
 *   stays, done or not, so a checklist shows what is ticked.
 */
import type { Id, Json } from "../../spec/common.ts";

export interface Row {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}
export interface Wire {
  id: Id;
  type: string;
  from: Id;
  to: Id;
}

/** What the outline reads from the page's index. */
export interface Source {
  item(id: Id): Row | undefined;
  /** Links at an item, both ways. */
  linksOf(id: Id): Wire[];
  /** Whether the item is left out (closed, and not work). */
  hidden(row: Row): boolean;
}

export interface Node {
  row: Row;
  depth: number;
  children: Node[];
}

/** Ids in the order found, moved so each comes after what it depends on among them. */
export function ordered(ids: Id[], dependsOn: (id: Id) => Id[]): Id[] {
  const among = new Set(ids);
  const out: Id[] = [];
  const placed = new Set<Id>();
  const visiting = new Set<Id>();
  const place = (id: Id) => {
    if (placed.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const d of dependsOn(id)) if (among.has(d)) place(d);
    visiting.delete(id);
    placed.add(id);
    out.push(id);
  };
  for (const id of ids) place(id);
  return out;
}

/** The sections a document opens with: those named, else the found items no other found item holds. */
export function sections(named: Id[] | undefined, found: Id[], src: Source): Id[] {
  if (named?.length) return named.filter((id) => src.item(id));
  const set = new Set(found);
  const held = (id: Id) => src.linksOf(id).some((l) => l.type === "part_of" && l.from === id && set.has(l.to));
  return found.filter((id) => !held(id));
}

/**
 * Work reads as one line: its title, or where the title is its note's
 * first paragraph cut short (a name is at most 60 characters), that
 * paragraph whole. The rest of a work item's note stays on its page.
 */
export function workLine(title: string, note: string): string {
  const first = note.trim().split(/\n\s*\n/)[0]?.replace(/\s*\n\s*/g, " ").trim() ?? "";
  const stem = title.replace(/\s*…$/, "").trim();
  return title.endsWith("…") && stem && first.startsWith(stem) ? first : title;
}

const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The headings of a note (`#` to `######`), as plain words. */
export function headings(note: string): string[] {
  return [...note.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => plain(m[1]!)).filter(Boolean);
}

/**
 * Whether a part is a section of its holder's note: its title ends with one
 * of the note's headings ("Sunday — 9–10:30 a.m. — readiness check" under
 * "## 9–10:30 a.m. — readiness check"). Such a part was split out of the
 * note; the note already reads it, in its own order.
 */
export function restates(title: string, heads: string[]): boolean {
  const t = plain(title);
  const cut = /…\s*$/.test(title) || title.length >= 58;
  return heads.some((h) => {
    if (h.length < 4) return false;
    if (t === h || t.endsWith(` ${h}`)) return true;
    // A title cut short (a name is at most 60 characters): where the heading starts in it, the rest begins the heading.
    const at = cut && h.length >= 12 ? t.indexOf(h.slice(0, 12)) : -1;
    return at >= 0 && (at === 0 || t[at - 1] === " ") && h.startsWith(t.slice(at));
  });
}

/** The outline under each section. An item already placed is not placed again. */
export function outline(roots: Id[], src: Source): Node[] {
  const seen = new Set<Id>();
  const dependsOn = (id: Id) => src.linksOf(id).filter((l) => l.type === "depends_on" && l.from === id).map((l) => l.to);
  const build = (id: Id, depth: number): Node | undefined => {
    const row = src.item(id);
    if (!row || seen.has(id) || src.hidden(row)) return undefined;
    seen.add(id);
    const heads = headings(typeof row.fields.note === "string" ? row.fields.note : "");
    const parts = src
      .linksOf(id)
      .filter((l) => l.type === "part_of" && l.to === id)
      .map((l) => l.from)
      .filter((c) => !restates(String(src.item(c)?.fields.title ?? ""), heads));
    const children = ordered([...new Set(parts)], dependsOn)
      .map((c) => build(c, depth + 1))
      .filter((n): n is Node => !!n);
    return { row, depth, children };
  };
  return roots.map((r) => build(r, 0)).filter((n): n is Node => !!n);
}
