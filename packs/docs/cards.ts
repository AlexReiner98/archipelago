/**
 * What a Packs view card shows, worked out from a pack's reference: pure,
 * so it is tested without a page. A card says what a pack is for and what
 * it adds, in plain words; the wiring (keys, config) stays in the
 * reference, for agents.
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

export interface Adds {
  /** Things people and agents can do: action titles. */
  actions: string[];
  /** Kinds of item and link. */
  kinds: string[];
  /** Views it puts in the shell. */
  views: string[];
  /** Parts it puts in other views. */
  parts: string[];
  /** How many things it says to agents. */
  says: number;
}

/** What a pack adds, in plain words. */
export function addsOf(doc: PackDoc): Adds {
  const fills = doc.slots?.fills ?? [];
  return {
    actions: doc.actions.map((a) => a.title),
    kinds: (doc.types ?? []).map((t) => (t.base === "link" ? `${t.name} (link)` : t.base ? `${t.name} (a kind of ${t.base})` : t.name)),
    views: fills.filter((f) => f.slot === "shell.main").map((f) => f.title ?? f.name),
    parts: fills.filter((f) => f.slot !== "shell.main" && f.slot !== "root" && f.title).map((f) => f.title!),
    says: doc.places.reduce((s, p) => s + p.nodes, 0),
  };
}

/** Packs with a problem first, then in the order they load. */
export const ordered = (docs: PackDoc[]) => [...docs].sort((a, b) => Number(troubled(b)) - Number(troubled(a)));

/** Whether a pack's card matches what is typed in the filter: its name, what it is for, or what it adds. */
export function matches(doc: PackDoc, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const a = addsOf(doc);
  const hay = [doc.id, doc.about ?? "", stateWords(doc) ?? "", ...a.actions, ...a.kinds, ...a.views, ...a.parts].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * One card per pack: a pack with a server half and a page half (the bridge,
 * docs) is one pack to a person. The page half adds its views; a problem in
 * either half shows.
 */
export function merged(server: PackDoc[], page: PackDoc[]): PackDoc[] {
  const halves = new Map(page.map((d) => [d.id, d]));
  const out = server.map((d) => {
    const p = halves.get(d.id);
    if (!p) return d;
    halves.delete(d.id);
    const worse = troubled(p) && !troubled(d) ? { state: p.state, ...(p.error ? { error: p.error } : {}) } : {};
    return { ...d, ...worse, ...(p.slots ? { slots: p.slots } : {}), about: d.about ?? p.about };
  });
  return [...out, ...halves.values()];
}
