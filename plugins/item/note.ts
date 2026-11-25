/**
 * An item's note, read in the map's dialect: the Markdown agents write on
 * the map. What comes before the first heading is the lead; each heading
 * starts a section, which the page folds. Blocks are paragraphs, lists,
 * quotes, fenced code and tables; inline are `code`, **bold**, *emphasis*,
 * [links](…), images ![alt](url) and item ids, which the page draws by
 * name. An image draws only from the map's own origin (`own`); any other
 * is a link at most, never fetched.
 *
 * Pure: text in, structure out, so the page and the tests read it alike.
 */

export type Span =
  | { k: "t"; text: string }
  | { k: "code"; text: string }
  | { k: "b"; text: string }
  | { k: "i"; text: string }
  /** A web link. */
  | { k: "a"; text: string; href: string }
  /** An image on the map's own origin: the page draws it, `alt` its caption. */
  | { k: "img"; alt: string; src: string }
  /** An item on the map, by id; `text` when the note names it itself. */
  | { k: "ref"; id: string; text?: string };

export type Block =
  | { k: "p"; text: string }
  | { k: "ul"; items: string[] }
  | { k: "ol"; items: string[] }
  | { k: "quote"; text: string }
  | { k: "code"; text: string }
  | { k: "table"; head: string[]; rows: string[][] };

export interface Section {
  title: string;
  /** 1 for `#`, 2 for `##`, … */
  depth: number;
  blocks: Block[];
}

export interface Note {
  lead: Block[];
  sections: Section[];
}

/** An item's id as the map writes it: `e_` or `i_`, then letters and digits. */
export const ID = /\b[ei]_[a-z0-9]{6,}\b/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** A note's text as its lead and its sections. */
export function parse(text: string): Note {
  const note: Note = { lead: [], sections: [] };
  let into = note.lead;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    const head = /^(#{1,6})\s+(.*)$/.exec(t);
    if (head) {
      const s: Section = { title: head[2]!.trim(), depth: head[1]!.length, blocks: [] };
      note.sections.push(s);
      into = s.blocks;
      i++;
      continue;
    }
    if (t.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) body.push(lines[i++]!);
      i++;
      into.push({ k: "code", text: body.join("\n") });
      continue;
    }
    if (t.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const r = cells(lines[i++]!);
        if (!r.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(r);
      }
      into.push({ k: "table", head: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    if (t.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) body.push(lines[i++]!.trim().replace(/^>\s?/, ""));
      into.push({ k: "quote", text: body.join(" ") });
      continue;
    }
    const bullet = /^[-*+]\s+/;
    const numbered = /^\d+[.)]\s+/;
    if (bullet.test(t) || numbered.test(t)) {
      const kind: "ul" | "ol" = bullet.test(t) ? "ul" : "ol";
      const mark = kind === "ul" ? bullet : numbered;
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!.trim();
        if (mark.test(l)) items.push(l.replace(mark, ""));
        // A line indented under an item carries it on.
        else if (l && /^\s/.test(lines[i]!) && items.length) items[items.length - 1] += " " + l;
        else break;
        i++;
      }
      into.push(kind === "ul" ? { k: "ul", items } : { k: "ol", items });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!.trim();
      if (!l || /^(#{1,6}\s|```|\||>|[-*+]\s|\d+[.)]\s)/.test(l)) break;
      body.push(l);
      i++;
    }
    into.push({ k: "p", text: body.join(" ") });
  }
  return note;
}

/**
 * Whether a URL is on the map's own origin, and so may load: a path on it
 * (`/files/shot.png`, `files/shot.png`) or a full URL at `origin` exactly.
 * Any other scheme or host, `//host/…` included, is not.
 */
export function own(url: string, origin?: string): boolean {
  const base = origin ?? "http://own.invalid";
  let at: URL;
  try {
    at = new URL(url, base + "/");
  } catch {
    return false;
  }
  return (at.protocol === "http:" || at.protocol === "https:") && at.origin === new URL(base).origin;
}

const INLINE = new RegExp(
  [
    /!\[([^\]]*)\]\(([^)\s]+)\)/.source,
    /`([^`]+)`/.source,
    /\*\*([^*]+)\*\*/.source,
    /\[([^\]]+)\]\(([^)\s]+)\)/.source,
    /(?<![\w*])[*_]([^*_\s][^*_]*?)[*_](?![\w*])/.source,
    `(${ID.source})`,
  ].join("|"),
  "g",
);

/** A line's text as spans. `origin` is the page's (`location.origin`): an image there loads. */
export function inline(text: string, origin?: string): Span[] {
  const out: Span[] = [];
  let at = 0;
  const plain = (s: string) => {
    if (!s) return;
    const last = out.at(-1);
    if (last?.k === "t") last.text += s;
    else out.push({ k: "t", text: s });
  };
  for (const m of text.matchAll(INLINE)) {
    plain(text.slice(at, m.index));
    at = m.index! + m[0].length;
    if (m[1] !== undefined) {
      const alt = m[1];
      const src = m[2]!;
      if (own(src, origin)) out.push({ k: "img", alt, src });
      // Off the map's origin: never fetched, a link to it at most.
      else if (/^(https?:)?\/\//.test(src)) out.push({ k: "a", text: alt || src, href: src.startsWith("//") ? `https:${src}` : src });
      else plain(alt);
    } else if (m[3] !== undefined) out.push({ k: "code", text: m[3] });
    else if (m[4] !== undefined) out.push({ k: "b", text: m[4] });
    else if (m[5] !== undefined) {
      const href = m[6]!;
      const id = new RegExp(`^${ID.source}$`).exec(href);
      if (id) out.push({ k: "ref", id: id[0], text: m[5] });
      else if (/^https?:\/\//.test(href)) out.push({ k: "a", text: m[5], href });
      // A path in another repository: its name, without a link that leads nowhere here.
      else plain(m[5]);
    } else if (m[7] !== undefined) out.push({ k: "i", text: m[7] });
    else out.push({ k: "ref", id: m[8]! });
  }
  plain(text.slice(at));
  return out;
}

/** The ids a note names, in order, once each: the page looks their names up. */
export function refs(text: string): string[] {
  return [...new Set(text.match(new RegExp(ID.source, "g")) ?? [])];
}
