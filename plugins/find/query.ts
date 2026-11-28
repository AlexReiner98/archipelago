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
 * - `as_of:<date>`: records true in the world on that date: `as_of` on or
 *   before it, and no `valid_to` or one after it. An item with no `as_of`
 *   fails the term (world time, not when the map learned it: that is
 *   history.at).
 * - `context:<title>` (once `umwelt:`): a context filter, read by the plugin that arranges the
 *   Landscape into its tree (plugins/arrange); it filters nothing here.
 *
 * An empty query is `is:open`. At most `limit` items come back, and the
 * links among them. A query that finds nothing says why: the words no title
 * in its pool holds (`missing`), or else the term that left nothing
 * (`empty_by`). No synonyms: strict matching is what makes "nothing" honest.
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
  /** The words no title in the query's pool holds; absent when every word is in some title. */
  missing?: string[];
  /** When nothing came back and no word is missing: the term that left nothing (`id:x`, `type:x`, `as_of:d`...). */
  empty_by?: string;
}

export interface Parsed {
  words: string[];
  is?: "open" | "closed";
  status?: string;
  type?: string;
  in?: Id;
  near?: Id;
  id?: Id;
  /** A date (ISO 8601): records true in the world then. */
  as_of?: string;
  /** A context filter's title (`context:`, once `umwelt:`): not a filter here (plugins/arrange reads it). */
  context?: string;
}

export function parse(q: string): Parsed {
  const p: Parsed = { words: [] };
  for (const tok of q.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(is|status|type|in|near|id|as_of|context|umwelt):(.+)$/.exec(tok);
    if (!m) p.words.push(tok.toLowerCase());
    else if (m[1] === "umwelt") p.context = m[2]!;
    else if (m[1] === "is") p.is = m[2] === "closed" ? "closed" : "open";
    else (p as unknown as Record<string, string>)[m[1]!] = m[2]!;
  }
  if (!p.words.length && !p.is && !p.status && !p.type && !p.in && !p.near && !p.id && !p.as_of) p.is = "open";
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

/** A date's time, or NaN when it is not one. */
const time = (v: Json | undefined): number => (typeof v === "string" ? Date.parse(v) : NaN);

/** Whether a row was true in the world on `day` (ms): its `as_of` on or before it, and no `valid_to` or one after it. */
export function trueOn(r: Row, day: number): boolean {
  const from = time(r.fields.as_of);
  if (!(from <= day)) return false;
  const to = r.fields.valid_to;
  return to === undefined || to === null || time(to) > day;
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
  const day = p.as_of === undefined ? undefined : time(p.as_of);
  // Each term on its own, so a query that finds nothing can say which one left nothing.
  const terms: [string, (r: Row) => boolean][] = [];
  if (p.type) terms.push([`type:${p.type}`, (r) => r.type === p.type || index.type(r.type)?.base === p.type]);
  if (p.status) terms.push([`status:${p.status}`, (r) => r.fields.status === p.status]);
  if (p.is) terms.push([`is:${p.is}`, (r) => closed(index.type(r.type), r.fields.status) === (p.is === "closed")]);
  if (day !== undefined) terms.push([`as_of:${p.as_of}`, (r) => trueOn(r, day)]);
  const titleOf = (r: Row) => String(r.fields.title ?? "").toLowerCase();
  const keep = (r: Row) => {
    if (!terms.every(([, t]) => t(r))) return false;
    if (p.words.length) {
      const title = titleOf(r);
      if (!p.words.every((w) => title.includes(w))) return false;
    }
    return true;
  };
  const rows = [...pool];
  const all = rows.filter(keep);
  const items = all.slice(0, limit);
  const ids = new Set(items.map((r) => r.id));
  const links = [...index.links.values()].filter((l) => ids.has(l.from) && ids.has(l.to));
  const out: Result = { items, links, more: all.length - items.length };
  // Why nothing: a pool term that named nothing, else the words no title in the pool holds,
  // else the first term that leaves none of the pool.
  const named = p.id ? `id:${p.id}` : p.in ? `in:${p.in}` : p.near ? `near:${p.near}` : undefined;
  const missing = p.words.filter((w) => !rows.some((r) => titleOf(r).includes(w)));
  if (!rows.length && named) out.empty_by = named;
  else if (missing.length) out.missing = missing;
  else if (!all.length) {
    const by = terms.find(([, t]) => !rows.some(t))?.[0];
    if (by) out.empty_by = by;
  }
  return out;
}
