/**
 * A person's changes to the page, laid over the tree the page started with.
 * Shared by the action that records them (index.ts) and the page pack that
 * applies them (view.ts). No page, no graph: Node can test it.
 */
import type { Json } from "../../spec/common.ts";
import type { FlavourDef } from "../../spec/types.ts";
import type { LoaderEntry } from "../../spec/loader.ts";

export const TYPE = "page";

/** The flavour: one item holds the page's changes, in its field `packs`. */
export const PAGE: FlavourDef = {
  name: TYPE,
  base: "record",
  doc: "The page's packs as a person changed them: on, off, config, order.",
  trial: false,
  fields: { packs: { kind: "json", doc: "Entry id to its change: { off, config, after }." } },
};

/** One entry's change. */
export interface Change {
  /** Turned off (true) or back on (false). Absent: as the template has it. */
  off?: boolean;
  /** Laid over the entry's config, key by key. */
  config?: Record<string, Json>;
  /** Placed after this sibling; `""` puts it first. */
  after?: string;
}
export type Changes = Record<string, Change>;

/** What `page.set` takes. */
export interface SetInput {
  /** The entry's id in the page's tree (`renderer`, `tabs`). */
  pack: string;
  /** On or off; `null` back to what the template says. */
  on?: boolean | null;
  /** Keys laid over its config; `null` clears every change to its config. */
  config?: Record<string, Json> | null;
  /** Place it after this sibling; `""` first; `null` back where the template has it. */
  after?: string | null;
}

/** The changes with one more applied. An entry left with no change drops out. */
export function merge(now: Changes, input: SetInput): Changes {
  const next: Changes = structuredClone(now);
  const c: Change = { ...next[input.pack] };
  if (input.on === null) delete c.off;
  else if (input.on !== undefined) c.off = !input.on;
  if (input.config === null) delete c.config;
  else if (input.config) c.config = { ...c.config, ...input.config };
  if (input.after === null) delete c.after;
  else if (input.after !== undefined) c.after = input.after;
  if (Object.keys(c).length) next[input.pack] = c;
  else delete next[input.pack];
  return next;
}

/** The template with the changes laid over it. An id the template lacks is ignored. */
export function overlay(base: LoaderEntry[], changes: Changes): LoaderEntry[] {
  const walk = (list: LoaderEntry[]): LoaderEntry[] => {
    const out = list.map((e): LoaderEntry => {
      const c = changes[e.id];
      const next: LoaderEntry = { ...e, ...(e.children ? { children: walk(e.children) } : {}) };
      if (!c) return next;
      if (c.off !== undefined) next.disabled = c.off;
      if (c.config) next.config = { ...(e.config as Record<string, unknown> | undefined), ...c.config };
      return next;
    });
    for (const e of [...out]) {
      const after = changes[e.id]?.after;
      if (after === undefined) continue;
      if (after !== "" && !out.some((x) => x.id === after)) continue;
      out.splice(out.indexOf(e), 1);
      out.splice(after === "" ? 0 : out.findIndex((x) => x.id === after) + 1, 0, e);
    }
    return out;
  };
  return walk(base);
}
