/**
 * What the field shows, as the legend sets it. Pure.
 *
 * The filter is what is hidden (so a type the map gains later shows): types,
 * a type's statuses or kinds, open or closed items, link types, and items
 * with no link. What is hidden is left out of the layout: the graph settles
 * again with what is shown.
 */
import type { Id } from "../../spec/common.ts";
import type { Dial } from "./behaviour.ts";
import { typeColours, type FieldIn } from "./graph.ts";

export interface Hide {
  types?: string[];
  /** `type:status`. */
  statuses?: string[];
  /** `type:kind`. */
  kinds?: string[];
  open?: boolean;
  closed?: boolean;
  links?: string[];
  /** Items with no link among the drawn ones. */
  lone?: boolean;
}

export interface Count {
  name: string;
  /** In the map. */
  n: number;
  /** Shown now. */
  shown: number;
}
export interface TypeFacet extends Count {
  colour: string;
  /** Its base, and the base's mark shape (an index in SHAPES; absent: circle). */
  base: string;
  shape?: number;
  /** Each status, with how full it is drawn (`side`, an index in SIDES; absent: done). */
  statuses: (Count & { closed: boolean; side?: number })[];
  kinds: Count[];
}
/** A base: its shape and the types drawn in it. */
export interface BaseFacet extends Count {
  shape?: number;
  types: string[];
}
export interface Facets {
  types: TypeFacet[];
  open: Count;
  closed: Count;
  links: Count[];
  lone: Count;
  items: Count;
  /** Each base, by its shape. */
  bases: BaseFacet[];
  /** Open items at their type's first status (drawn hollow) and at a later one (half). */
  fresh: Count;
  moving: Count;
}

const NO_KIND = "no kind";
const has = (list: string[] | undefined, v: string) => !!list?.includes(v);

/** Which items and links are shown under `hide`. */
export function shown(input: FieldIn, hide: Hide): { items: Set<Id>; links: Set<Id> } {
  const degree = new Map<Id, number>();
  for (const l of input.links) degree.set(l.from, (degree.get(l.from) ?? 0) + 1), degree.set(l.to, (degree.get(l.to) ?? 0) + 1);
  const items = new Set<Id>();
  for (const it of input.items) {
    if (has(hide.types, it.type)) continue;
    if (has(hide.statuses, `${it.type}:${it.status}`)) continue;
    if (has(hide.kinds, `${it.type}:${it.kind || NO_KIND}`)) continue;
    if (it.closed ? hide.closed : hide.open) continue;
    if (hide.lone && !degree.get(it.id)) continue;
    items.add(it.id);
  }
  const links = new Set<Id>();
  for (const l of input.links) if (!has(hide.links, l.type) && items.has(l.from) && items.has(l.to)) links.add(l.id);
  return { items, links };
}

/** The map's types, statuses, kinds, sides and link types, each counted in all and as shown. */
export function facets(input: FieldIn, hide: Hide, pal: string[] = []): Facets {
  const { items, links } = shown(input, hide);
  const count = <K>(m: Map<K, Count>, key: K, name: string, on: boolean) => {
    let c = m.get(key);
    if (!c) m.set(key, (c = { name, n: 0, shown: 0 }));
    c.n++;
    if (on) c.shown++;
    return c;
  };
  const types = new Map<string, Count>(), statuses = new Map<string, Map<string, Count & { closed: boolean; side?: number }>>(), kinds = new Map<string, Map<string, Count>>();
  const open: Count = { name: "open", n: 0, shown: 0 }, closed: Count = { name: "closed", n: 0, shown: 0 };
  const degree = new Map<Id, number>();
  for (const l of input.links) degree.set(l.from, (degree.get(l.from) ?? 0) + 1), degree.set(l.to, (degree.get(l.to) ?? 0) + 1);
  const lone: Count = { name: "no links", n: 0, shown: 0 };
  const fresh: Count = { name: "first status", n: 0, shown: 0 }, moving: Count = { name: "later status", n: 0, shown: 0 };
  const look = new Map<string, { base: string; shape?: number }>();
  for (const it of input.items) {
    const on = items.has(it.id);
    count(types, it.type, it.type, on);
    if (!statuses.has(it.type)) statuses.set(it.type, new Map());
    const st = count(statuses.get(it.type)! as Map<string, Count>, it.status, it.status || "no status", on) as Count & { closed: boolean; side?: number };
    st.closed = it.closed;
    if (it.side !== undefined) st.side = it.side;
    if (!look.has(it.type)) look.set(it.type, { base: it.base || it.type, shape: it.shape });
    if (!it.closed) {
      const c = it.side === 0 ? fresh : it.side === 1 ? moving : null;
      if (c) (c.n++, on && c.shown++);
    }
    if (!kinds.has(it.type)) kinds.set(it.type, new Map());
    count(kinds.get(it.type)!, it.kind || NO_KIND, it.kind || NO_KIND, on);
    const side = it.closed ? closed : open;
    side.n++;
    if (on) side.shown++;
    if (!degree.get(it.id)) (lone.n++, on && lone.shown++);
  }
  const linkCounts = new Map<string, Count>();
  for (const l of input.links) count(linkCounts, l.type, l.type, links.has(l.id));
  // Colours by the whole map's order of types (input.types), so they match the particles whatever is hidden.
  const colour = new Map(typeColours(input.types ?? input.items.map((it) => it.type), pal).map((t) => [t.name, t.colour]));
  const colours = [...types.keys()].sort().map((name) => ({ name, colour: colour.get(name) ?? "" }));
  const byN = (a: Count, b: Count) => b.n - a.n || (a.name < b.name ? -1 : 1);
  const bases = new Map<string, BaseFacet>();
  for (const [name, c] of [...types].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const { base, shape } = look.get(name)!;
    let b = bases.get(base);
    if (!b) bases.set(base, (b = { name: base, n: 0, shown: 0, shape, types: [] }));
    b.n += c.n;
    b.shown += c.shown;
    b.types.push(name);
  }
  return {
    types: colours.map(({ name, colour }) => ({
      ...types.get(name)!,
      colour,
      ...look.get(name)!,
      statuses: [...statuses.get(name)!.entries()].map(([status, c]) => ({ ...c, name: status })).sort((a, b) => (a.side ?? 9) - (b.side ?? 9) || byN(a, b)) as TypeFacet["statuses"],
      kinds: [...kinds.get(name)!.values()].sort(byN),
    })),
    open,
    closed,
    links: [...linkCounts.values()].sort(byN),
    lone,
    items: { name: "items", n: input.items.length, shown: items.size },
    bases: [...bases.values()].sort((a, b) => (a.shape ?? 99) - (b.shape ?? 99) || byN(a, b)),
    fresh,
    moving,
  };
}

/** `hide` with one value switched: a list entry added or taken out, or a flag flipped. */
export function toggle(hide: Hide, key: "types" | "statuses" | "kinds" | "links", value: string): Hide;
export function toggle(hide: Hide, key: "open" | "closed" | "lone"): Hide;
export function toggle(hide: Hide, key: keyof Hide, value?: string): Hide {
  const next: Hide = { ...hide };
  if (value === undefined) {
    const flag = key as "open" | "closed" | "lone";
    if (hide[flag]) delete next[flag];
    else next[flag] = true;
    return next;
  }
  const list = key as "types" | "statuses" | "kinds" | "links";
  const had = hide[list] ?? [];
  const now = had.includes(value) ? had.filter((v) => v !== value) : [...had, value];
  if (now.length) next[list] = now;
  else delete next[list];
  return next;
}

export { NO_KIND };

/** Found by the find line: lit, named first. */
export const FOUND = 2;
/** Within `find_steps` links of what is found: drawn in full, as its context. */
export const NEAR = 1;
/** Within `find_faint` more links: drawn at `query_fade`, the edge of the context. */
export const FAINT = 0;

/** The find line's dials: how much of the map round what it finds stays in the layout. */
export const FIND: Dial[] = [
  { key: "find_steps", label: "keeps steps", min: 0, max: 4, step: 1, value: 1, then: "paint", doc: "While the find line has words, what it finds stays, with what lies this many links from it, drawn in full; the rest of the map leaves the layout and what is kept settles again." },
  { key: "find_faint", label: "then faint steps", min: 0, max: 4, step: 1, value: 1, then: "paint", doc: "This many links further still stay too, drawn faint (the drawing's 'find fades rest to')." },
  { key: "find_follow_ms", label: "camera jumps in", min: 0, max: 3000, step: 50, value: 350, then: "paint", doc: "When the find line's words change, how fast the view goes to what is kept, in ms (about two thirds of the way in this time; 0: it snaps)." },
];

/**
 * What the find line keeps: each item within `steps + faint` links of one
 * it finds (over the links given, so a hidden link type is not walked), by
 * how it is drawn: FOUND, NEAR or FAINT. Items not in `items` are never kept.
 */
export function around(input: FieldIn, found: Set<Id>, steps: number, faint: number): Map<Id, number> {
  const ids = new Set(input.items.map((it) => it.id));
  const next = new Map<Id, Id[]>();
  for (const l of input.links) {
    if (!ids.has(l.from) || !ids.has(l.to)) continue;
    (next.get(l.from) ?? next.set(l.from, []).get(l.from)!).push(l.to);
    (next.get(l.to) ?? next.set(l.to, []).get(l.to)!).push(l.from);
  }
  const level = new Map<Id, number>();
  let ring: Id[] = [];
  for (const id of found) if (ids.has(id)) level.set(id, FOUND), ring.push(id);
  for (let d = 1; d <= steps + faint && ring.length; d++) {
    const out: Id[] = [];
    for (const id of ring) for (const j of next.get(id) ?? []) if (!level.has(j)) level.set(j, d <= steps ? NEAR : FAINT), out.push(j);
    ring = out;
  }
  return level;
}
