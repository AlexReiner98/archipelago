/**
 * What the Packs view shows, worked out from the packs' reference: pure,
 * so it is tested without a page. As in other apps' plugin lists, a card
 * is the line the pack declares (`about`) and counts of what it adds, each
 * opening its list; problems show only when there are any. The counts are
 * live where they can be: how many items of each kind the map holds, what
 * the pack did in the newest run.
 */
import type { Json } from "../../spec/common.ts";
import type { PackDoc } from "./read.ts";

/** Whether a pack has a problem: it waits for another, or failed. */
export const troubled = (doc: PackDoc) => doc.state === "waiting" || doc.state === "failed" || !!doc.error;

/** What a pack's state means to a person, when it isn't simply running. */
export function stateWords(doc: PackDoc): string | undefined {
  if (doc.error || doc.state === "failed") return `Failed to start${doc.error ? `: ${doc.error}` : "."}`;
  if (doc.state === "waiting") return "Waiting for another pack to load.";
  if (doc.state === "off") return "Turned off.";
  if (doc.state !== "active") return `${doc.state[0]!.toUpperCase()}${doc.state.slice(1)}.`;
  return undefined;
}

/** A thing the view names, and where it opens: a view, the Map on a query, a run, or another pack. */
export interface Named {
  title: string;
  view?: string;
  query?: string;
  run?: string;
  pack?: string;
}

/** A count on a card ("42 items"), and what it opens: its list, or one place. */
export interface Count {
  key: string;
  label: string;
  items?: Named[];
  to?: Named;
}

/** The region views go in (spec/frame.md): the frame shows one at a time. */
export const CENTER = "center";

const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
const ownKeys = (doc: PackDoc) => new Set(doc.provides.map((k) => k.key));

const name = (d: PackDoc) => d.folder ?? d.id;

/** The packs that use what `doc` provides: within its own runtime, by the name its card has. */
export function usedBy(doc: PackDoc, all: PackDoc[]): string[] {
  if (doc.users) return doc.users;
  const keys = ownKeys(doc);
  return [...new Set(all.filter((d) => name(d) !== name(doc) && d.side === doc.side && d.inject.some((k) => keys.has(k.key))).map(name))];
}

/** The packs whose capabilities `doc` uses: within its own runtime, by the name its card has. */
export function uses(doc: PackDoc, all: PackDoc[]): string[] {
  if (doc.uses) return doc.uses;
  const wanted = new Set(doc.inject.map((k) => k.key));
  return [...new Set(all.filter((d) => name(d) !== name(doc) && d.side === doc.side && d.provides.some((k) => wanted.has(k.key))).map(name))];
}

/** Foundation: it provides one of the spec's interfaces, which every feature stands on. */
export const foundation = (doc: PackDoc) => doc.provides.some((k) => !!k.contract);

/** Views, parts of views, and kinds of item with how many the map holds. */
export function addsOf(doc: PackDoc, all: PackDoc[] = []) {
  const fills = doc.slots?.fills ?? [];
  const owner = new Map(all.flatMap((d) => (d.slots?.declares ?? []).map((s) => [s.name, d.id] as const)));
  const views: Named[] = fills.filter((f) => f.slot === CENTER).map((f) => ({ title: f.title ?? f.name, view: doc.id }));
  // A part opens the view it is in, when the pack that declared its slot has one.
  const hasView = (id: string | undefined) => !!id && all.some((d) => d.id === id && d.slots?.fills.some((f) => f.slot === CENTER));
  const parts: Named[] = fills
    .filter((f) => f.slot !== CENTER && f.slot !== "root" && f.title)
    .map((f) => ({ title: f.title!, ...(hasView(owner.get(f.slot)) ? { view: owner.get(f.slot) } : {}) }));
  const kinds = (doc.types ?? []).filter((t) => t.base !== "link");
  const links = (doc.types ?? []).filter((t) => t.base === "link");
  const items = kinds.reduce((s, t) => s + (t.count ?? 0), 0);
  const more = kinds.some((t) => t.more);
  return { views, parts, kinds, links, items, more, counted: kinds.some((t) => t.count !== undefined) };
}

/** What a pack adds, as counts; `all` is every pack, for where a part shows and what uses what. */
export function countsOf(doc: PackDoc, all: PackDoc[] = []): Count[] {
  const a = addsOf(doc, all);
  const out: Count[] = [];
  if (a.views.length) out.push({ key: "views", label: n(a.views.length, "view"), items: a.views });
  if (a.parts.length) out.push({ key: "parts", label: n(a.parts.length, "part of a view", "parts of views"), items: a.parts });
  if (a.kinds.length) {
    const kinds: Named[] = a.kinds.map((t) => ({
      title: `${t.name}${t.base ? ` (a kind of ${t.base})` : ""}${t.count !== undefined ? `: ${t.count}${t.more ? "+" : ""}` : ""}`,
      query: `type:${t.name}`,
    }));
    const label = a.counted ? `${a.items}${a.more ? "+" : ""} ${a.items === 1 && !a.more ? "item" : "items"}` : n(a.kinds.length, "kind of item", "kinds of item");
    out.push({ key: "kinds", label, items: kinds });
  }
  if (a.links.length) out.push({ key: "links", label: n(a.links.length, "kind of link", "kinds of link"), items: a.links.map((t) => ({ title: t.name })) });
  if (doc.actions.length) out.push({ key: "actions", label: n(doc.actions.length, "action"), items: doc.actions.map((x) => ({ title: x.title })) });
  const nodes = doc.places.reduce((s, p) => s + p.nodes, 0);
  if (nodes) out.push({ key: "says", label: `${n(nodes, "node")} for agents`, to: { title: "Reflex tree", view: "reflex" } });
  const act = doc.activity;
  if (act && act.said + act.refused + act.acted) {
    const parts = [act.said ? `said ${n(act.said, "time")}` : "", act.refused ? `refused ${act.refused}` : "", act.acted ? n(act.acted, "act") : ""].filter(Boolean);
    out.push({ key: "run", label: `last run: ${parts.join(", ")}`, to: { title: "the run", view: "harness", run: act.run } });
  }
  const users = usedBy(doc, all);
  if (users.length) out.push({ key: "used", label: `used by ${n(users.length, "pack")}`, items: users.map((id) => ({ title: id, pack: id })) });
  return out;
}

/** The view's lists: what needs attention, then features, then the foundation. Each by name; empty ones left out. */
export function listsOf(docs: PackDoc[]): { key: string; title: string; doc: string; docs: PackDoc[] }[] {
  const byName = (a: PackDoc, b: PackDoc) => a.id.localeCompare(b.id);
  const fine = docs.filter((d) => !troubled(d));
  return [
    { key: "trouble", title: "Needs attention", doc: "Waiting for another pack, or failed.", docs: docs.filter(troubled) },
    { key: "features", title: "Features", doc: "What the system does.", docs: fine.filter((d) => !foundation(d)) },
    { key: "foundation", title: "Foundation", doc: "The spec's interfaces, which every feature stands on.", docs: fine.filter(foundation) },
  ]
    .map((l) => ({ ...l, docs: [...l.docs].sort(byName) }))
    .filter((l) => l.docs.length);
}

/** Whether a pack's card matches what is typed in the filter: its name, what it is for, or what it adds. */
export function matches(doc: PackDoc, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [doc.id, doc.about ?? "", stateWords(doc) ?? "", ...countsOf(doc).flatMap((c) => (c.items ?? []).map((i) => i.title))].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

const union = <T extends { key: string }>(a: T[], b: T[]) => [...a, ...b.filter((k) => !a.some((x) => x.key === k.key))];
const worst = (docs: PackDoc[]) => docs.find((d) => d.error || d.state === "failed") ?? docs.find(troubled) ?? docs.find((d) => d.state !== "active") ?? docs[0]!;

/**
 * One card per pack as a person sees it: the packs in one folder (a server
 * half and a page half, a pack and its tool) are one. Its line is the one
 * whose id is the folder's; a problem in any of them shows.
 */
export function byFolder(docs: PackDoc[]): PackDoc[] {
  // What uses what, read in each runtime before the halves join: the page's
  // bridge provides the server's keys there, and that is no tie on the server.
  const tied = docs.map((d) => ({ ...d, uses: uses(d, docs), users: usedBy(d, docs) }));
  const groups = new Map<string, PackDoc[]>();
  for (const d of tied) {
    const k = d.folder ?? d.id;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return [...groups].map(([id, ds]) => {
    if (ds.length === 1) return { ...ds[0]!, id };
    const w = worst(ds);
    const places = new Map<string, number>();
    for (const d of ds) for (const p of d.places) places.set(p.place, (places.get(p.place) ?? 0) + p.nodes);
    const acts = ds.map((d) => d.activity).filter((a) => !!a);
    const slots = ds.filter((d) => d.slots);
    return {
      ...ds[0]!,
      id,
      about: (ds.find((d) => d.id === id) ?? ds.find((d) => d.about))?.about,
      state: w.state,
      ...(w.missing ? { missing: w.missing } : {}),
      ...(w.error ? { error: w.error } : {}),
      provides: ds.reduce((a, d) => union(a, d.provides), [] as PackDoc["provides"]),
      inject: ds.reduce((a, d) => union(a, d.inject), [] as PackDoc["inject"]),
      actions: ds.flatMap((d) => d.actions),
      types: ds.flatMap((d) => d.types ?? []),
      places: [...places].map(([place, nodes]) => ({ place, nodes })).sort((a, b) => b.nodes - a.nodes),
      ...(slots.length ? { slots: { declares: slots.flatMap((d) => d.slots!.declares), fills: slots.flatMap((d) => d.slots!.fills) } } : {}),
      ...(acts.length ? { activity: acts.reduce((a, b) => ({ run: a.run, said: a.said + b.said, refused: a.refused + b.refused, acted: a.acted + b.acted })) } : {}),
      builtIn: ds.every((d) => d.builtIn !== false),
      uses: [...new Set(ds.flatMap((d) => d.uses ?? []))],
      users: [...new Set(ds.flatMap((d) => d.users ?? []))],
      parts: [...new Set(ds.flatMap((d) => [d.id, ...(d.parts ?? [])]))],
    };
  });
}

export interface Field {
  name: string;
  type: string;
  required: boolean;
  doc?: string;
}

/** An action's input, field by field, from its JSON Schema: for the detail page. */
export function fieldsOf(schema: Json | undefined): Field[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const props = schema.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(props).map(([name, p]) => {
    const o = p && typeof p === "object" && !Array.isArray(p) ? p : {};
    const items = o.items && typeof o.items === "object" && !Array.isArray(o.items) ? o.items : undefined;
    const type = Array.isArray(o.enum)
      ? o.enum.map((v) => JSON.stringify(v)).join(" or ")
      : o.type === "array" && typeof items?.type === "string"
        ? `list of ${items.type}`
        : typeof o.type === "string"
          ? o.type
          : "anything";
    return { name, type, required: required.has(name), ...(typeof o.description === "string" ? { doc: o.description } : {}) };
  });
}
