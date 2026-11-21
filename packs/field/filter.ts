/**
 * What the field shows, as the legend sets it. Pure.
 *
 * The filter is what is hidden (so a type the map gains later shows): types,
 * a type's statuses or kinds, open or closed items, link types, and items
 * with no link. What is hidden is left out of the layout: the graph settles
 * again with what is shown.
 */
import type { Id } from "../../spec/common.ts";
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
  statuses: (Count & { closed: boolean })[];
  kinds: Count[];
}
export interface Facets {
  types: TypeFacet[];
  open: Count;
  closed: Count;
  links: Count[];
  lone: Count;
  items: Count;
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
  const types = new Map<string, Count>(), statuses = new Map<string, Map<string, Count & { closed: boolean }>>(), kinds = new Map<string, Map<string, Count>>();
  const open: Count = { name: "open", n: 0, shown: 0 }, closed: Count = { name: "closed", n: 0, shown: 0 };
  const degree = new Map<Id, number>();
  for (const l of input.links) degree.set(l.from, (degree.get(l.from) ?? 0) + 1), degree.set(l.to, (degree.get(l.to) ?? 0) + 1);
  const lone: Count = { name: "no links", n: 0, shown: 0 };
  for (const it of input.items) {
    const on = items.has(it.id);
    count(types, it.type, it.type, on);
    if (!statuses.has(it.type)) statuses.set(it.type, new Map());
    const st = count(statuses.get(it.type)! as Map<string, Count>, it.status, it.status || "no status", on) as Count & { closed: boolean };
    st.closed = it.closed;
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
  return {
    types: colours.map(({ name, colour }) => ({
      ...types.get(name)!,
      colour,
      statuses: [...statuses.get(name)!.entries()].map(([status, c]) => ({ ...c, name: status })).sort(byN) as TypeFacet["statuses"],
      kinds: [...kinds.get(name)!.values()].sort(byN),
    })),
    open,
    closed,
    links: [...linkCounts.values()].sort(byN),
    lone,
    items: { name: "items", n: input.items.length, shown: items.size },
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
