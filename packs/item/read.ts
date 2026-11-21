/**
 * What the item page shows, worked out from what it is handed: the item's
 * fields as marks, its neighbours by kind of link, and each change set in
 * its history as lines about this item. Pure, so the page and the tests
 * read alike.
 */
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import type { FieldDef } from "../../spec/types.ts";

/** The fields the page draws elsewhere: in the head, and as the note. */
export const DRAWN = new Set(["title", "note", "status"]);

export interface Mark {
  field: string;
  /** What the mark reads: short. */
  text: string;
  /** The whole value, for its tooltip. */
  full: string;
  /** For an `id` field: the item it names, to open. */
  id?: Id;
}

const SHORT = 32;
const cut = (s: string) => (s.length > SHORT ? s.slice(0, SHORT - 1) + "…" : s);

/** A value as one line, by its field's kind. */
export function shown(def: FieldDef | undefined, v: Json): string {
  if (v === null || v === undefined) return "";
  if (def?.kind === "boolean") return v ? "yes" : "no";
  if (def?.kind === "date" && typeof v === "string") return v.slice(0, 10);
  if (def?.kind === "number" && typeof v === "number") return v.toLocaleString("en");
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" · ");
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * The item's fields as marks, in its type's order, besides those drawn
 * elsewhere. A yes is the field's name alone, a no is left out; the rest
 * read `field value`, cut short.
 */
export function marks(fields: Record<string, Json>, defs: Record<string, FieldDef>): Mark[] {
  const out: Mark[] = [];
  const names = [...Object.keys(defs), ...Object.keys(fields).filter((k) => !(k in defs))];
  for (const field of names) {
    const v = fields[field];
    if (DRAWN.has(field) || v === undefined || v === null || v === "") continue;
    const def = defs[field];
    if (def?.kind === "boolean" || typeof v === "boolean") {
      if (v) out.push({ field, text: field, full: `${field}: yes` });
      continue;
    }
    const full = shown(def, v);
    const m: Mark = { field, text: `${field} ${cut(full)}`, full: `${field}: ${full}` };
    if (def?.kind === "id" && typeof v === "string") m.id = v;
    out.push(m);
  }
  return out;
}

export interface Wire {
  id: Id;
  type: string;
  from: Id;
  to: Id;
  fields: Record<string, Json>;
}

export interface Group {
  /** The kind of link. */
  kind: string;
  /** `out`: this item is its `from`; `in`: its `to`. */
  dir: "out" | "in";
  /** The kind in words: `depends on`. */
  label: string;
  /** The items at the other end, with the link to each. */
  ends: { id: Id; link: Id; for?: string }[];
}

/** A kind of link in words. */
export const words = (kind: string) => kind.replace(/_/g, " ");

/**
 * The item's neighbours by kind of link: what it points at first, then
 * what points at it, each kind once, in the order links came.
 */
export function neighbours(id: Id, wires: readonly Wire[]): Group[] {
  const groups = new Map<string, Group>();
  for (const dir of ["out", "in"] as const) {
    for (const w of wires) {
      if ((dir === "out" ? w.from : w.to) !== id) continue;
      const key = `${dir} ${w.type}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { kind: w.type, dir, label: words(w.type), ends: [] }));
      const end: Group["ends"][number] = { id: dir === "out" ? w.to : w.from, link: w.id };
      if (typeof w.fields.for === "string") end.for = w.fields.for;
      g.ends.push(end);
    }
  }
  return [...groups.values()];
}

/** One thing a change set did to this item. */
export type Line =
  | { k: "made" }
  | { k: "removed" }
  | { k: "set"; field: string; from?: Json; to?: Json }
  | { k: "linked" | "unlinked"; kind: string; dir: "out" | "in"; other: Id };

const LONG = 40;
/** A value short enough to show in a line about a change; a long one is only said to have changed. */
export const brief = (v: Json | undefined): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > LONG || s.includes("\n") ? undefined : s;
};

/** What a change set's facts did to the item `id`: its own fields, and links to or from it. */
export function lines(id: Id, facts: readonly Fact[]): Line[] {
  const out: Line[] = [];
  const own = new Map<string, { from?: Json; to?: Json }>();
  const links = new Map<Id, { add: boolean; type?: string; from?: Id; to?: Id }>();
  for (const [op, at, field, value] of facts) {
    if (at === id) {
      const f = own.get(field) ?? {};
      if (op === "-") f.from = value;
      else f.to = value;
      own.set(field, f);
      continue;
    }
    const l = links.get(at) ?? { add: op === "+" };
    if (field === "type" && typeof value === "string") (l.type = value), (l.add = op === "+");
    if (field === "from" && typeof value === "string") l.from = value;
    if (field === "to" && typeof value === "string") l.to = value;
    links.set(at, l);
  }
  const type = own.get("type");
  if (type?.to !== undefined && type.from === undefined) out.push({ k: "made" });
  else if (type?.from !== undefined && type.to === undefined) out.push({ k: "removed" });
  else {
    for (const [field, f] of own) {
      if (field === "type" || JSON.stringify(f.from) === JSON.stringify(f.to)) continue;
      out.push({ k: "set", field, ...(f.from !== undefined ? { from: f.from } : {}), ...(f.to !== undefined ? { to: f.to } : {}) });
    }
  }
  for (const l of links.values()) {
    if (!l.type || (l.from !== id && l.to !== id)) continue;
    const dir = l.from === id ? "out" : "in";
    const other = dir === "out" ? l.to : l.from;
    if (other) out.push({ k: l.add ? "linked" : "unlinked", kind: l.type, dir, other });
  }
  return out;
}

/**
 * How many other items a change set touched besides `id`: those whose own
 * fields it changed, and the far ends of links it made or cut that don't
 * reach `id`. Undo takes them back too.
 */
export function others(id: Id, facts: readonly Fact[]): number {
  const links = new Map<Id, Set<Id>>();
  for (const [, at, field, value] of facts) {
    if ((field === "from" || field === "to") && typeof value === "string") {
      const ends = links.get(at) ?? new Set<Id>();
      ends.add(value);
      links.set(at, ends);
    }
  }
  const out = new Set<Id>();
  for (const [, at] of facts) if (!links.has(at)) out.add(at);
  for (const ends of links.values()) if (!ends.has(id)) for (const e of ends) out.add(e);
  out.delete(id);
  return out.size;
}

/** A time as how long ago, short: `now`, `5m`, `3h`, `2d`, else the date. */
export function ago(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d`;
  return iso.slice(0, 10);
}
