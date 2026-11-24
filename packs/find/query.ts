/**
 * The query find runs: pure, over an index of items and links. One line,
 * words and terms:
 *
 * - words match the title, all of them, in any case;
 * - `is:open` / `is:closed`: by the status's side in its base;
 * - `status:doing`, `type:question` (a type or its base);
 * - `in:<id>`: the item and everything part_of it, at any depth;
 * - `near:<id>`: the item and what it is linked to directly;
 * - `id:<id>`: the item alone.
 * - `context:<title>` (once `umwelt:`): a context filter, read by the pack that arranges the
 *   Landscape into its tree (packs/arrange); it filters nothing here.
 *
 * An empty query is `is:open`. At most `limit` items come back, and the
 * links among them.
 */
import type { Id, Json } from "../../spec/common.ts";
import type { TypeInfo } from "../../spec/types.ts";

export interface Row {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}
export interface Wire extends Row {
  from: Id;
  to: Id;
}

export interface Index {
  items: Map<Id, Row>;
  links: Map<Id, Wire>;
  type(name: string): TypeInfo | undefined;
}

export interface Result {
  items: Row[];
  links: Wire[];
  /** How many more matched than came back. */
  more: number;
}

export interface Parsed {
  words: string[];
  is?: "open" | "closed";
  status?: string;
  type?: string;
  in?: Id;
  near?: Id;
  id?: Id;
  /** A context filter's title (`context:`, once `umwelt:`): not a filter here (packs/arrange reads it). */
  context?: string;
}

export function parse(q: string): Parsed {
  const p: Parsed = { words: [] };
  for (const tok of q.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(is|status|type|in|near|id|context|umwelt):(.+)$/.exec(tok);
    if (!m) p.words.push(tok.toLowerCase());
    else if (m[1] === "umwelt") p.context = m[2]!;
    else if (m[1] === "is") p.is = m[2] === "closed" ? "closed" : "open";
    else (p as unknown as Record<string, string>)[m[1]!] = m[2]!;
  }
  if (!p.words.length && !p.is && !p.status && !p.type && !p.in && !p.near && !p.id) p.is = "open";
  return p;
}

/** Whether a status is on its base's closed side. Unknown statuses count as open. */
export function closed(t: TypeInfo | undefined, status: Json | undefined): boolean {
  return !!t && typeof status === "string" && t.statuses.closed.includes(status);
}

/** An item named by its id, or else by its title (underscores for spaces, any case): what `in:` and `near:` take. */
export function itemRef(index: Index, ref: string): Id {
  if (index.items.has(ref)) return ref;
  const want = ref.replace(/_/g, " ").toLowerCase();
  for (const r of index.items.values()) if (String(r.fields.title ?? "").toLowerCase() === want) return r.id;
  return ref;
}

export function run(index: Index, q: string, limit = 150): Result {
  const p = parse(q);
  if (p.in) p.in = itemRef(index, p.in);
  if (p.near) p.near = itemRef(index, p.near);
  let pool: Iterable<Row> = index.items.values();
  if (p.id) pool = [index.items.get(p.id)].filter((x): x is Row => !!x);
  if (p.in) {
    const inside = new Set<Id>([p.in]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const l of index.links.values()) {
        if (l.type === "part_of" && inside.has(l.to) && !inside.has(l.from)) {
          inside.add(l.from);
          grew = true;
        }
      }
    }
    pool = [...inside].map((id) => index.items.get(id)).filter((x): x is Row => !!x);
  }
  if (p.near) {
    const near = new Set<Id>([p.near]);
    for (const l of index.links.values()) {
      if (l.from === p.near) near.add(l.to);
      if (l.to === p.near) near.add(l.from);
    }
    pool = [...near].map((id) => index.items.get(id)).filter((x): x is Row => !!x);
  }
  const keep = (r: Row) => {
    const t = index.type(r.type);
    if (p.type && r.type !== p.type && t?.base !== p.type) return false;
    if (p.status && r.fields.status !== p.status) return false;
    if (p.is && closed(t, r.fields.status) !== (p.is === "closed")) return false;
    if (p.words.length) {
      const title = String(r.fields.title ?? "").toLowerCase();
      if (!p.words.every((w) => title.includes(w))) return false;
    }
    return true;
  };
  const all = [...pool].filter(keep);
  const items = all.slice(0, limit);
  const ids = new Set(items.map((r) => r.id));
  const links = [...index.links.values()].filter((l) => ids.has(l.from) && ids.has(l.to));
  return { items, links, more: all.length - items.length };
}
