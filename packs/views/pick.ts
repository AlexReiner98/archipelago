/**
 * The views a person can pick, as data: one for each kind of fill in
 * `center` (seeded from the fills, no item needed), and one for each item
 * of the flavour `view`. Which is home, which are pinned, the sections and
 * the search. No page, no graph: Node can test it.
 */
import type { Id, Json } from "../../spec/common.ts";
import type { Arrange } from "../../spec/slot.ts";
import type { FlavourDef } from "../../spec/types.ts";

export const TYPE = "view";
export const HOME = "home";
export const PINNED = "pinned";

/** The flavour: a view is one item holding a whole arrangement. */
export const VIEW: FlavourDef = {
  name: TYPE,
  base: "record",
  doc: "A whole arrangement of the page: what fills center, its settings, and where every other fill goes.",
  trial: false,
  fields: {
    center: { kind: "text", doc: "The fill shown in center, as pack/name (map/map, field/field)." },
    here: { kind: "json", doc: "Settings: here keys set while it shows ({ \"find.query\": \"in:i_…\" })." },
    arrange: { kind: "json", doc: "Fill (pack/name) to a region, a slot or \"off\", laid over the page's while it shows." },
    tags: { kind: "text", doc: "Words: home (opens first, tops the list), pinned (next in the list)." },
  },
};

/** A fill in center, as the slot broker gives it. */
export interface Kind {
  pack: string;
  name: string;
  title?: string;
}

/** An item as the page's copy of the map holds it. */
export interface Row {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}

export interface View {
  /** The item's id, or for a kind its hash: its pack, or pack/name when the pack has two. */
  id: string;
  title: string;
  /** The center fill, pack/name. */
  center: string;
  here: Record<string, Json>;
  arrange: Arrange;
  home: boolean;
  pinned: boolean;
  /** Seeded from a fill, not an item. */
  kind: boolean;
  /** What it is part_of: the section it is listed under. */
  section?: { id: Id; title: string };
}

export interface Config {
  /** The kind that is home while no view item is tagged home. Default `field`. */
  home?: string;
  /** Kinds listed next after home, in order. */
  pinned?: string[];
}

const words = (v: Json | undefined) => (typeof v === "string" ? v.toLowerCase().split(/[\s,]+/).filter(Boolean) : []);
const obj = <T>(v: Json | undefined): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : ({} as T));

/**
 * Every view there is, home first, then the pinned in order, then the rest by
 * section and title. A view whose center fill isn't loaded is left out.
 * `parent` answers what an item is part_of.
 */
export function views(kinds: Kind[], rows: Row[], parent: (id: Id) => { id: Id; title: string } | undefined, config: Config = {}): View[] {
  const centers = new Set(kinds.map((k) => `${k.pack}/${k.name}`));
  const hashOf = (k: Kind) => (kinds.filter((g) => g.pack === k.pack).length > 1 ? `${k.pack}/${k.name}` : k.pack);
  const pinned = config.pinned ?? [];
  const seeded: View[] = kinds.map((k) => {
    const id = hashOf(k);
    return { id, title: k.title ?? k.pack, center: `${k.pack}/${k.name}`, here: {}, arrange: {}, home: false, pinned: pinned.includes(id), kind: true };
  });
  const stored: View[] = rows
    .filter((r) => r.type === TYPE && typeof r.fields.center === "string" && centers.has(r.fields.center))
    .map((r) => {
      const tags = words(r.fields.tags);
      const section = parent(r.id);
      return {
        id: r.id,
        title: typeof r.fields.title === "string" && r.fields.title ? r.fields.title : r.id,
        center: r.fields.center as string,
        here: obj(r.fields.here),
        arrange: obj(r.fields.arrange),
        home: tags.includes(HOME),
        pinned: tags.includes(PINNED),
        kind: false,
        ...(section ? { section } : {}),
      };
    });
  // One home: the newest item tagged home (ids grow with time), else the configured kind, else the first.
  const tagged = stored.filter((v) => v.home).sort((a, b) => (a.id < b.id ? 1 : -1));
  for (const v of stored) v.home = false;
  const home = tagged[0] ?? seeded.find((v) => v.id === (config.home ?? "field")) ?? seeded[0] ?? stored[0];
  if (home) home.home = true;

  const all = [...seeded, ...stored];
  const rank = (v: View) => (v.home ? 0 : v.pinned ? 1 : 2);
  const pinOrder = (v: View) => (v.kind ? pinned.indexOf(v.id) : pinned.length);
  const sectionOf = (v: View) => v.section?.title ?? "";
  return all.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 1 ? pinOrder(a) - pinOrder(b) : 0) ||
      Number(a.kind) - Number(b.kind) ||
      sectionOf(a).localeCompare(sectionOf(b)) ||
      a.title.localeCompare(b.title),
  );
}

/** Sections for the list, in order: each section's title (`""` for views part of nothing) and its views. */
export function sections(list: View[]): { title: string; views: View[] }[] {
  const out: { title: string; views: View[] }[] = [];
  for (const v of list) {
    const title = v.home || v.pinned ? "" : v.kind ? "" : (v.section?.title ?? "");
    let s = out.find((x) => x.title === title);
    if (!s) out.push((s = { title, views: [] }));
    s.views.push(v);
  }
  return out;
}

/** The views whose title or section hold every word typed. */
export function search(list: View[], q: string): View[] {
  const want = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!want.length) return list;
  return list.filter((v) => {
    const text = `${v.title} ${v.section?.title ?? ""}`.toLowerCase();
    return want.every((w) => text.includes(w));
  });
}

/** The view a hash names: its id, or its center fill (an older `#map/map` link). */
export function byHash(list: View[], hash: string): View | undefined {
  const want = decodeURIComponent(hash.replace(/^#/, ""));
  if (!want) return undefined;
  return list.find((v) => v.id === want) ?? list.find((v) => v.kind && v.center === want);
}
