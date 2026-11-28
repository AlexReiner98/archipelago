/**
 * What the Plugins view shows, worked out from the plugins' reference: pure,
 * so it is tested without a page. As in other apps' plugin lists, a card
 * is the line the plugin declares (`about`) and counts of what it adds, each
 * opening its list; problems show only when there are any. The counts are
 * live where they can be: how many items of each kind the map holds, what
 * the plugin did in the newest run.
 */
import type { Json } from "../../spec/common.ts";
import { shortPath, type PluginDoc } from "./read.ts";

/** Whether a plugin has a problem: it waits for another, or failed. */
export const troubled = (doc: PluginDoc) => doc.state === "waiting" || doc.state === "failed" || !!doc.error;

/** What a plugin's state means to a person, when it isn't simply running. */
export function stateWords(doc: PluginDoc): string | undefined {
  if (doc.error || doc.state === "failed") return `Failed to start${doc.error ? `: ${doc.error}` : "."}`;
  if (doc.state === "waiting") return "Waiting for another plugin to load.";
  if (doc.state === "off") return "Turned off.";
  if (doc.state !== "active") return `${doc.state[0]!.toUpperCase()}${doc.state.slice(1)}.`;
  return undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A time as a person reads it beside now: "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else the date. */
export function ago(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** A time of day with seconds, in the page's own zone: when a failure was seen. */
const clock = (iso: string) => {
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/**
 * Where a plugin came from, in one line: "this repository at 3f2a1c9,
 * changed 2 days ago"; "outside: my-plugins v1.2.0, changed today";
 * edits not committed say so.
 */
export function originWords(doc: PluginDoc, now: number = Date.now()): string | undefined {
  const o = doc.origin;
  if (!o) return undefined;
  const from = o.from === "repository" ? "This repository" : `Outside: ${o.name ?? o.path ?? "a folder"}`;
  const at = [o.version ? `v${o.version}` : "", o.commit ? `at ${o.commit}` : ""].filter(Boolean).join(" ");
  const changed = o.changed ? (o.edited ? `edited ${ago(o.changed, now)}, not committed` : `changed ${ago(o.changed, now)}`) : o.edited ? "edited, not committed" : "";
  return [[from, at].filter(Boolean).join(" "), changed].filter(Boolean).join(", ");
}

/** What went wrong for a failed plugin: its error, when it was seen, and where to look. Undefined when nothing failed. */
export function failureOf(doc: PluginDoc, now: number = Date.now()): { error: string; when?: string; look: string[] } | undefined {
  if (!doc.error && doc.state !== "failed") return undefined;
  const w = doc.where ?? {};
  const look = [
    w.file ? `${shortPath(w.file)}, where it threw` : w.module ? `${shortPath(w.module)}, its module` : "",
    w.log ? (w.log.startsWith("the ") ? w.log : `the log, ${w.log}`) : "",
  ].filter(Boolean);
  return {
    error: doc.error ?? "It failed to load.",
    ...(doc.failedAt ? { when: `Seen failing at ${clock(doc.failedAt)}, ${ago(doc.failedAt, now)}` } : {}),
    look,
  };
}

/** A thing the view names, and where it opens: a view, the Map on a query, a run, or another plugin. */
export interface Named {
  title: string;
  view?: string;
  query?: string;
  run?: string;
  plugin?: string;
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
const ownKeys = (doc: PluginDoc) => new Set(doc.provides.map((k) => k.key));

const name = (d: PluginDoc) => d.folder ?? d.id;

/** The plugins that use what `doc` provides: within its own runtime, by the name its card has. */
export function usedBy(doc: PluginDoc, all: PluginDoc[]): string[] {
  if (doc.users) return doc.users;
  const keys = ownKeys(doc);
  return [...new Set(all.filter((d) => name(d) !== name(doc) && d.side === doc.side && d.inject.some((k) => keys.has(k.key))).map(name))];
}

/** The plugins whose capabilities `doc` uses: within its own runtime, by the name its card has. */
export function uses(doc: PluginDoc, all: PluginDoc[]): string[] {
  if (doc.uses) return doc.uses;
  const wanted = new Set(doc.inject.map((k) => k.key));
  return [...new Set(all.filter((d) => name(d) !== name(doc) && d.side === doc.side && d.provides.some((k) => wanted.has(k.key))).map(name))];
}

/** Foundation: it provides one of the spec's interfaces, which every feature stands on. */
export const foundation = (doc: PluginDoc) => doc.provides.some((k) => !!k.contract);

/** Views, parts of views, and kinds of item with how many the map holds. */
export function addsOf(doc: PluginDoc, all: PluginDoc[] = []) {
  const fills = doc.slots?.fills ?? [];
  const owner = new Map(all.flatMap((d) => (d.slots?.declares ?? []).map((s) => [s.name, d.id] as const)));
  const views: Named[] = fills.filter((f) => f.slot === CENTER).map((f) => ({ title: f.title ?? f.name, view: doc.id }));
  // A part opens the view it is in, when the plugin that declared its slot has one.
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

/** What a plugin adds, as counts; `all` is every plugin, for where a part shows and what uses what. */
export function countsOf(doc: PluginDoc, all: PluginDoc[] = []): Count[] {
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
  if (nodes) out.push({ key: "says", label: `${n(nodes, "node")} for agents`, to: { title: "Context interface", view: "harness" } });
  const act = doc.activity;
  if (act && act.said + act.refused + act.acted) {
    const parts = [act.said ? `said ${n(act.said, "time")}` : "", act.refused ? `refused ${act.refused}` : "", act.acted ? n(act.acted, "act") : ""].filter(Boolean);
    out.push({ key: "run", label: `last run: ${parts.join(", ")}`, to: { title: "the run", view: "harness", run: act.run } });
  }
  const users = usedBy(doc, all);
  if (users.length) out.push({ key: "used", label: `used by ${n(users.length, "plugin")}`, items: users.map((id) => ({ title: id, plugin: id })) });
  return out;
}

/** The view's lists: what needs attention, then features, then the foundation. Each by name; empty ones left out. */
export function listsOf(docs: PluginDoc[]): { key: string; title: string; doc: string; docs: PluginDoc[] }[] {
  const byName = (a: PluginDoc, b: PluginDoc) => a.id.localeCompare(b.id);
  const fine = docs.filter((d) => !troubled(d));
  return [
    { key: "trouble", title: "Needs attention", doc: "Waiting for another plugin, or failed.", docs: docs.filter(troubled) },
    { key: "features", title: "Features", doc: "What the system does.", docs: fine.filter((d) => !foundation(d)) },
    { key: "foundation", title: "Foundation", doc: "The spec's interfaces, which every feature stands on.", docs: fine.filter(foundation) },
  ]
    .map((l) => ({ ...l, docs: [...l.docs].sort(byName) }))
    .filter((l) => l.docs.length);
}

/** Whether a plugin's card matches what is typed in the filter: its name, what it is for, or what it adds. */
export function matches(doc: PluginDoc, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [doc.id, doc.about ?? "", stateWords(doc) ?? "", ...countsOf(doc).flatMap((c) => (c.items ?? []).map((i) => i.title))].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

const union = <T extends { key: string }>(a: T[], b: T[]) => [...a, ...b.filter((k) => !a.some((x) => x.key === k.key))];
const worst = (docs: PluginDoc[]) => docs.find((d) => d.error || d.state === "failed") ?? docs.find(troubled) ?? docs.find((d) => d.state !== "active") ?? docs[0]!;

/**
 * One card per plugin as a person sees it: the plugins in one folder (a server
 * half and a page half, a plugin and its tool) are one. Its line is the one
 * whose id is the folder's; a problem in any of them shows.
 */
export function byFolder(docs: PluginDoc[]): PluginDoc[] {
  // What uses what, read in each runtime before the halves join: the page's
  // bridge provides the server's keys there, and that is no tie on the server.
  const tied = docs.map((d) => ({ ...d, uses: uses(d, docs), users: usedBy(d, docs) }));
  const groups = new Map<string, PluginDoc[]>();
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
    // Where it came from: the half named for the folder, else any half the server read it for.
    const origin = (ds.find((d) => d.id === id && d.origin) ?? ds.find((d) => d.origin))?.origin;
    return {
      ...ds[0]!,
      id,
      about: (ds.find((d) => d.id === id) ?? ds.find((d) => d.about))?.about,
      state: w.state,
      ...(w.missing ? { missing: w.missing } : {}),
      ...(w.error ? { error: w.error } : {}),
      ...(w.failedAt ? { failedAt: w.failedAt } : {}),
      ...(w.where ? { where: w.where } : {}),
      ...(w.stack ? { stack: w.stack } : {}),
      ...(origin ? { origin } : {}),
      provides: ds.reduce((a, d) => union(a, d.provides), [] as PluginDoc["provides"]),
      inject: ds.reduce((a, d) => union(a, d.inject), [] as PluginDoc["inject"]),
      actions: ds.flatMap((d) => d.actions),
      types: ds.flatMap((d) => d.types ?? []),
      places: [...places].map(([place, nodes]) => ({ place, nodes })).sort((a, b) => b.nodes - a.nodes),
      ...(slots.length ? { slots: { declares: slots.flatMap((d) => d.slots!.declares), fills: slots.flatMap((d) => d.slots!.fills) } } : {}),
      ...(acts.length ? { activity: acts.reduce((a, b) => ({ run: a.run, said: a.said + b.said, refused: a.refused + b.refused, acted: a.acted + b.acted })) } : {}),
      builtIn: ds.every((d) => d.builtIn !== false),
      uses: [...new Set(ds.flatMap((d) => d.uses ?? []))],
      users: [...new Set(ds.flatMap((d) => d.users ?? []))],
      parts: [...new Set(ds.flatMap((d) => [d.id, ...(d.parts ?? [])]))],
      ...(ds.some((d) => d.entries) ? { entries: ds.flatMap((d) => d.entries ?? []) } : {}),
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
