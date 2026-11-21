/**
 * What a Packs view card shows, worked out from the packs' reference:
 * pure, so it is tested without a page. A card says what a pack is for and
 * what it adds, in plain words; the wiring (keys, config) stays in the
 * reference, for agents. The wiring is read here only to say things in
 * plain words: which packs one is used by, and which group it belongs to.
 */
import type { PackDoc } from "./read.ts";

/** Whether a pack has a problem: it waits for another, or failed. */
export const troubled = (doc: PackDoc) => doc.state === "waiting" || doc.state === "failed" || !!doc.error;

/** What a pack's state means to a person. */
export function stateWords(doc: PackDoc): string | undefined {
  if (doc.error || doc.state === "failed") return `Failed to start${doc.error ? `: ${doc.error}` : "."}`;
  if (doc.state === "waiting") return "Waiting for another pack to load.";
  if (doc.state === "off") return "Turned off.";
  if (doc.state !== "active") return `${doc.state[0]!.toUpperCase()}${doc.state.slice(1)}.`;
  return undefined;
}

/** A thing a card names, and where it opens: a view's hash, or a query on the Map. */
export interface Named {
  title: string;
  /** A view to open: its hash. */
  view?: string;
  /** A query for the Map to draw. */
  query?: string;
}

export interface Adds {
  /** Views it puts on the page, each opening its own. */
  views: Named[];
  /** Parts it puts in other views, each opening the view it is in. */
  parts: Named[];
  /** Kinds of item and link, each opening the Map on them. */
  kinds: Named[];
  /** What agents can do with it: its actions' titles. */
  actions: string[];
  /** How many things it says to agents. */
  says: number;
  /** The packs that use what it provides. */
  usedBy: string[];
}

/** The packs that use what `doc` provides, by name. */
export function usedBy(doc: PackDoc, all: PackDoc[]): string[] {
  const keys = new Set(doc.provides.map((k) => k.key));
  return all.filter((d) => d.id !== doc.id && d.inject.some((k) => keys.has(k.key))).map((d) => d.id);
}

/** What a pack adds, in plain words; `all` is every pack, for what is used by what and where a part shows. */
export function addsOf(doc: PackDoc, all: PackDoc[] = []): Adds {
  const fills = doc.slots?.fills ?? [];
  const owner = new Map(all.flatMap((d) => (d.slots?.declares ?? []).map((s) => [s.name, d.id] as const)));
  return {
    views: fills.filter((f) => f.slot === "shell.main").map((f) => ({ title: f.title ?? f.name, view: doc.id })),
    parts: fills
      .filter((f) => f.slot !== "shell.main" && f.slot !== "root" && f.title)
      .map((f) => ({ title: f.title!, ...(owner.get(f.slot) ? { view: owner.get(f.slot) } : {}) })),
    kinds: (doc.types ?? []).map((t) => ({
      title: t.base === "link" ? `${t.name} (link)` : t.base ? `${t.name} (a kind of ${t.base})` : t.name,
      ...(t.base === "link" ? {} : { query: `type:${t.name}` }),
    })),
    actions: doc.actions.map((a) => a.title),
    says: doc.places.reduce((s, p) => s + p.nodes, 0),
    usedBy: usedBy(doc, all),
  };
}

/** The groups the view shows, in order, each with what it means. */
export const GROUPS = [
  { id: "trouble", title: "Needs attention", doc: "Packs that are waiting or failed." },
  { id: "views", title: "Views", doc: "What you see on the page." },
  { id: "agents", title: "Talks to agents", doc: "What agents hear and use as they work." },
  { id: "kinds", title: "Kinds of item", doc: "What the map is made of." },
  { id: "core", title: "Core", doc: "What the rest stands on." },
  { id: "other", title: "Other", doc: "" },
] as const;
export type Group = (typeof GROUPS)[number]["id"];

/** Where an agent and the map meet: these keys. */
const AGENT_KEYS = new Set(["agent.run", "mcp.host"]);

/** A pack's group, from what it adds: the first that fits. */
export function groupOf(doc: PackDoc, all: PackDoc[]): Group {
  if (troubled(doc)) return "trouble";
  const a = addsOf(doc, all);
  if (a.views.length || a.parts.length) return "views";
  if (a.says || [...doc.inject, ...doc.provides].some((k) => AGENT_KEYS.has(k.key))) return "agents";
  if (a.kinds.length) return "kinds";
  if (a.usedBy.length) return "core";
  return "other";
}

/** The packs by group, in the groups' order; within one, the order they load. Empty groups are left out. */
export function grouped(docs: PackDoc[], all: PackDoc[] = docs): { group: (typeof GROUPS)[number]; docs: PackDoc[] }[] {
  return GROUPS.map((group) => ({ group, docs: docs.filter((d) => groupOf(d, all) === group.id) })).filter((g) => g.docs.length);
}

/** Whether a pack's card matches what is typed in the filter: its name, what it is for, or what it adds. */
export function matches(doc: PackDoc, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const a = addsOf(doc);
  const hay = [doc.id, doc.about ?? "", stateWords(doc) ?? "", ...a.actions, ...[...a.kinds, ...a.views, ...a.parts].map((n) => n.title)].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * One card per pack: a pack with a server half and a page half (the bridge,
 * docs) is one pack to a person. The page half adds its views and what it
 * provides; a problem in either half shows.
 */
export function merged(server: PackDoc[], page: PackDoc[]): PackDoc[] {
  const halves = new Map(page.map((d) => [d.id, d]));
  const union = <T extends { key: string }>(a: T[], b: T[]) => [...a, ...b.filter((k) => !a.some((x) => x.key === k.key))];
  const out = server.map((d) => {
    const p = halves.get(d.id);
    if (!p) return d;
    halves.delete(d.id);
    const worse = troubled(p) && !troubled(d) ? { state: p.state, ...(p.error ? { error: p.error } : {}) } : {};
    return { ...d, ...worse, provides: union(d.provides, p.provides), inject: union(d.inject, p.inject), ...(p.slots ? { slots: p.slots } : {}), about: d.about ?? p.about };
  });
  return [...out, ...halves.values()];
}
