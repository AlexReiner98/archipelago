/**
 * What stands on what, between the Plugins view's cards: pure, so it is
 * tested without a page. A card stands on the plugins it uses (it injects
 * what they provide, docs' `uses`) and on the plugins whose slots it fills
 * (a part stands on the plugin that declared its slot). Turning a plugin off stops every
 * card that stands on it, and the ones that stand on those.
 */
import type { EntryDoc, PluginDoc } from "../docs/read.ts";

/**
 * What the Plugins view and its switch stand on, besides themselves: the
 * view (docs), the switch, the page following its item (page), undo
 * (history), and the frame that draws the regions views show in (frame).
 * Turning one of these, or anything they stand on, off here would stop the
 * switch that turns it back on.
 */
export const ROOTS = ["docs", "switch", "page", "history", "frame"];

/** The cards `doc` stands on, by name: those it uses, and those whose slots it fills. */
export function standsOn(doc: PluginDoc, all: PluginDoc[]): string[] {
  const owner = new Map(all.flatMap((d) => (d.slots?.declares ?? []).map((s) => [s.name, d.id] as const)));
  const slots = (doc.slots?.fills ?? []).map((f) => owner.get(f.slot)).filter((x): x is string => !!x);
  return [...new Set([...(doc.uses ?? []), ...slots])].filter((x) => x !== doc.id);
}

const isOff = (d: PluginDoc) => !!d.entries?.length && d.entries.every((e) => e.off);

/** The running cards that stop when `id` is turned off: every one that stands on it, however far down. */
export function stops(id: string, all: PluginDoc[]): string[] {
  const on = new Map(all.map((d) => [d.id, standsOn(d, all)]));
  const out = new Set<string>();
  let edge = [id];
  while (edge.length) {
    const next: string[] = [];
    for (const d of all) {
      if (d.id === id || out.has(d.id) || isOff(d)) continue;
      if (on.get(d.id)!.some((x) => edge.includes(x))) out.add(d.id), next.push(d.id);
    }
    edge = next;
  }
  return [...out].sort();
}

/** The cards the switch can't turn off: the roots, and all they stand on. */
export function needed(all: PluginDoc[], roots = ROOTS): Set<string> {
  const by = new Map(all.map((d) => [d.id, d]));
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id) || !by.has(id)) return;
    out.add(id);
    for (const x of standsOn(by.get(id)!, all)) walk(x);
  };
  roots.forEach(walk);
  return out;
}

/** What `switch.set` takes to turn a card on or off: its entries, by the runtime each is in. */
export function plan(entries: EntryDoc[], on: boolean): { page: string[]; server: string[]; on: boolean } {
  const ids = (side: string) => entries.filter((e) => e.side === side).map((e) => e.id);
  return { page: ids("page"), server: ids("server"), on };
}

/** A type no plugin defines now, as `schema.untyped` gives it: the plugin that last defined it, and how many items hold it. */
export interface Untyped {
  type: string;
  plugin?: string;
  base?: string;
  /** When it was last seen defined. */
  seen?: string;
  items: number;
  more?: boolean;
}

/** What a card leaves on the graph without its type, now that it is off: the untyped kinds its plugins defined last. */
export function leftBy(doc: PluginDoc, untyped: readonly Untyped[]): Untyped[] {
  const ids = new Set([doc.id, ...(doc.parts ?? []), ...(doc.entries ?? []).map((e) => e.id)]);
  return untyped.filter((u) => u.plugin !== undefined && ids.has(u.plugin));
}

/** How many items a card's kinds hold, from the counts on its card; `more` when one was past its page. */
export function holds(doc: PluginDoc): { items: number; more: boolean; kinds: string[] } {
  const kinds = (doc.types ?? []).filter((t) => t.count);
  return { items: kinds.reduce((s, t) => s + (t.count ?? 0), 0), more: kinds.some((t) => t.more), kinds: kinds.map((t) => t.name) };
}

/**
 * The untyped kinds no card answers for: the plugin that last defined them is
 * not loaded at all (deleted, or never added here), or none was ever seen
 * defining them. No card's switch can bring them back, so the Plugins view
 * shows them in a list of their own.
 */
export function orphans(untyped: readonly Untyped[], all: readonly PluginDoc[]): Untyped[] {
  return untyped.filter((u) => !all.some((d) => leftBy(d, [u]).length));
}
