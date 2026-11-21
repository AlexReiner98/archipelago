/**
 * What a Packs view card shows, worked out from the packs' reference:
 * pure, so it is tested without a page. As in other apps' plugin lists, a
 * card is the line the pack declares (`about`) and counts of what it adds,
 * each opening its list; problems show only when there are any. The
 * wiring (keys, config) stays in the reference, for agents; here it is
 * read only to say, as a count, how many packs use one.
 */
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

/** A thing a card names, and where it opens: a view's hash, or a query for the Map. */
export interface Named {
  title: string;
  view?: string;
  query?: string;
}

/** A count on a card ("3 kinds of item"), and what it opens: its list, or a view. */
export interface Count {
  key: string;
  label: string;
  items?: Named[];
  view?: string;
}

/** The packs that use what `doc` provides, by name. */
export function usedBy(doc: PackDoc, all: PackDoc[]): string[] {
  const keys = new Set(doc.provides.map((k) => k.key));
  return all.filter((d) => d.id !== doc.id && d.inject.some((k) => keys.has(k.key))).map((d) => d.id);
}

const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

/** What a pack adds, as counts; `all` is every pack, for where a part shows and what uses what. */
export function countsOf(doc: PackDoc, all: PackDoc[] = []): Count[] {
  const fills = doc.slots?.fills ?? [];
  const owner = new Map(all.flatMap((d) => (d.slots?.declares ?? []).map((s) => [s.name, d.id] as const)));
  const views: Named[] = fills.filter((f) => f.slot === "shell.main").map((f) => ({ title: f.title ?? f.name, view: doc.id }));
  const parts: Named[] = fills
    .filter((f) => f.slot !== "shell.main" && f.slot !== "root" && f.title)
    .map((f) => ({ title: f.title!, ...(owner.get(f.slot) ? { view: owner.get(f.slot) } : {}) }));
  const kinds: Named[] = (doc.types ?? []).map((t) => ({
    title: t.base === "link" ? `${t.name} (link)` : t.base ? `${t.name} (a kind of ${t.base})` : t.name,
    ...(t.base === "link" ? {} : { query: `type:${t.name}` }),
  }));
  const actions: Named[] = doc.actions.map((a) => ({ title: a.title }));
  const says = doc.places.reduce((s, p) => s + p.nodes, 0);
  const users: Named[] = usedBy(doc, all).map((id) => ({ title: id }));
  const out: Count[] = [];
  if (views.length) out.push({ key: "views", label: n(views.length, "view"), items: views });
  if (parts.length) out.push({ key: "parts", label: n(parts.length, "part of a view", "parts of views"), items: parts });
  if (kinds.length) out.push({ key: "kinds", label: n(kinds.length, "kind of item", "kinds of item"), items: kinds });
  if (actions.length) out.push({ key: "actions", label: n(actions.length, "action"), items: actions });
  if (says) out.push({ key: "says", label: `${n(says, "thing")} said to agents`, view: "reflex" });
  if (users.length) out.push({ key: "used", label: `used by ${n(users.length, "pack")}`, items: users });
  return out;
}

/** The view's lists: what needs attention, then built in, then added. Empty ones are left out. */
export function listsOf(docs: PackDoc[]): { key: string; title: string; docs: PackDoc[] }[] {
  return [
    { key: "trouble", title: "Needs attention", docs: docs.filter(troubled) },
    { key: "built", title: "Built in", docs: docs.filter((d) => !troubled(d) && d.builtIn !== false) },
    { key: "added", title: "Added", docs: docs.filter((d) => !troubled(d) && d.builtIn === false) },
  ].filter((l) => l.docs.length);
}

/** Whether a pack's card matches what is typed in the filter: its name, what it is for, or what it adds. */
export function matches(doc: PackDoc, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [doc.id, doc.about ?? "", stateWords(doc) ?? "", ...countsOf(doc).flatMap((c) => (c.items ?? []).map((i) => i.title))].join(" ").toLowerCase();
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
