/**
 * The Markdown the repository's docs are written in, read into blocks the
 * Guide draws (guide.ts). Small on purpose: headings, paragraphs, lists
 * (nested), fenced code, tables, quotes; inline code, links, bold and
 * italic. HTML comments are dropped, and no HTML is passed through: what
 * the page draws is built from these blocks, never set as markup.
 *
 * Also how a link resolves: `resolve(from, href)` a path from the
 * repository's root and an anchor, and `slug(heading)` an anchor the way
 * GitHub makes one, so a link that works there works here.
 *
 * Runs on both sides: the server reads a chapter's title and the test
 * checks links with it, the page draws it.
 */

export type Block =
  | { t: "h"; level: number; text: string; id: string }
  | { t: "p"; text: string }
  | { t: "code"; lang: string; text: string }
  | { t: "list"; ordered: boolean; items: Block[][] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "quote"; blocks: Block[] };

export type Inline =
  | { t: "text"; text: string }
  | { t: "code"; text: string }
  | { t: "b"; parts: Inline[] }
  | { t: "i"; parts: Inline[] }
  | { t: "a"; href: string; parts: Inline[] };

/** A part of a chapter: the blocks under one `##` heading (`##` and deeper inside), or the lead before the first. */
export interface Section {
  /** The `##` heading, absent for the lead. */
  head?: Extract<Block, { t: "h" }>;
  blocks: Block[];
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)\s*([\w-]*)/;
const HEAD = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** An anchor for a heading, as GitHub makes one: lower case, punctuation dropped, spaces to dashes. */
export function slug(text: string): string {
  return plain(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

/** A heading's or a cell's text without its marks. */
export function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\*(.+?)\*/g, "$1");
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/** Reads Markdown into blocks. Headings get ids, made unique in the file the way GitHub does (`-1`, `-2`). */
export function parse(source: string): Block[] {
  const seen = new Map<string, number>();
  const id = (text: string) => {
    const s = slug(text);
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    return n ? `${s}-${n}` : s;
  };
  return blocks(source.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n"), id);
}

function blocks(lines: string[], id: (text: string) => string): Block[] {
  const out: Block[] = [];
  let i = 0;
  const blank = (l: string | undefined) => l === undefined || !l.trim();
  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!);
      i++;
      out.push({ t: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    const head = HEAD.exec(line);
    if (head) {
      out.push({ t: "h", level: head[1]!.length, text: head[2]!, id: id(head[2]!) });
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && RULE.test(lines[i + 1] ?? "")) {
      const headCells = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!));
      out.push({ t: "table", head: headCells, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", blocks: blocks(body, id) });
      continue;
    }
    const item = LIST.exec(line);
    if (item) {
      const base = item[1]!.length;
      const ordered = /\d/.test(item[2]!);
      const items: Block[][] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]!);
        if (!m || m[1]!.length !== base) break;
        const indent = base + m[2]!.length + 1;
        const body = [m[3]!];
        i++;
        // An item goes on while its lines are indented past its marker, or are blank before more of it.
        while (i < lines.length) {
          const l = lines[i]!;
          if (blank(l)) {
            const next = lines[i + 1];
            if (next !== undefined && !blank(next) && next.search(/\S/) >= indent) {
              body.push("");
              i++;
              continue;
            }
            break;
          }
          const lead = l.search(/\S/);
          const sub = LIST.exec(l);
          if (sub && sub[1]!.length <= base) break;
          if (lead < indent && !sub && (HEAD.test(l) || FENCE.test(l) || /^\s*[|>]/.test(l))) break;
          body.push(lead >= indent ? l.slice(indent) : l.trimStart());
          i++;
        }
        items.push(blocks(body, id));
      }
      out.push({ t: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !blank(lines[i]) && !HEAD.test(lines[i]!) && !FENCE.test(lines[i]!) && !LIST.exec(lines[i]!) && !/^\s*>/.test(lines[i]!)) {
      if (lines[i]!.trim().startsWith("|") && RULE.test(lines[i + 1] ?? "")) break;
      para.push(lines[i++]!.trim());
    }
    if (para.length) out.push({ t: "p", text: para.join(" ") });
    else i++;
  }
  return out;
}

/** Reads a line's inline marks. */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", text: buf });
    buf = "";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length && /[\\`*_[\]()#|<>-]/.test(text[i + 1]!)) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ t: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === "[" || (c === "!" && text[i + 1] === "[")) {
      const m = /^!?\[((?:[^\]\\]|\\.)*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(text.slice(i));
      if (m) {
        flush();
        out.push({ t: "a", href: m[2]!, parts: inline(m[1]!) });
        i += m[0].length;
        continue;
      }
    }
    if (text.startsWith("**", i) || text.startsWith("__", i)) {
      const mark = text.slice(i, i + 2);
      const end = text.indexOf(mark, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "b", parts: inline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (c === "*" && text[i + 1] !== " ") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "i", parts: inline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    const url = /^https?:\/\/[^\s)<>]+[^\s)<>.,;:]/.exec(text.slice(i));
    if (url && (i === 0 || /\s|\(/.test(text[i - 1]!))) {
      flush();
      out.push({ t: "a", href: url[0], parts: [{ t: "text", text: url[0] }] });
      i += url[0].length;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** A chapter's title (its first `#` heading) and its parts under each `##`. */
export function chapter(source: string): { title?: string; sections: Section[] } {
  const all = parse(source);
  const first = all.findIndex((b) => b.t === "h" && b.level === 1);
  const title = first >= 0 ? (all[first] as Extract<Block, { t: "h" }>).text : undefined;
  const rest = first >= 0 ? all.filter((_, k) => k !== first) : all;
  const sections: Section[] = [{ blocks: [] }];
  for (const b of rest) {
    if (b.t === "h" && b.level <= 2) sections.push({ head: b, blocks: [] });
    else sections[sections.length - 1]!.blocks.push(b);
  }
  if (!sections[0]!.blocks.length) sections.shift();
  return { title, sections };
}

/** Every link in some blocks, inline ones included. */
export function links(bs: Block[]): string[] {
  const out: string[] = [];
  const walk = (parts: Inline[]) => {
    for (const p of parts) {
      if (p.t === "a") out.push(p.href), walk(p.parts);
      else if (p.t === "b" || p.t === "i") walk(p.parts);
    }
  };
  const text = (s: string) => walk(inline(s));
  for (const b of bs) {
    if (b.t === "p" || b.t === "h") text(b.text);
    else if (b.t === "list") b.items.forEach((it) => out.push(...links(it)));
    else if (b.t === "quote") out.push(...links(b.blocks));
    else if (b.t === "table") [b.head, ...b.rows].flat().forEach(text);
  }
  return out;
}

/** An external link: it leaves the repository. */
export const external = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

/**
 * Where a relative link in the file at `from` points: a path from the
 * repository's root (no leading slash; a folder keeps its trailing slash)
 * and an anchor. A bare `#anchor` points into `from` itself. Undefined for
 * an external link, or one that leaves the repository.
 */
export function resolve(from: string, href: string): { path: string; anchor?: string } | undefined {
  if (external(href)) return undefined;
  const [p, anchor] = href.split("#", 2) as [string, string | undefined];
  const base = from.split("/").slice(0, -1);
  const parts = p ? (p.startsWith("/") ? [] : base) : from.split("/");
  if (p) {
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (!parts.length) return undefined;
        parts.pop();
      } else parts.push(seg);
    }
  }
  const dir = p.endsWith("/") || p === "." || p === "..";
  const path = parts.join("/") + (dir && parts.length ? "/" : "");
  return anchor ? { path, anchor: decodeURIComponent(anchor) } : { path };
}
