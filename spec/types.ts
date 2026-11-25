/**
 * types: what kinds of item and link the map holds. See types.md.
 *
 * Few bases, flavours (20 Nov 2026): a base decides statuses and
 * behaviour; a flavour names its base and adds fields only. The UI,
 * verdicts and statuses know bases and field kinds, never a type's name.
 */
import type { Capability, Dispose, PluginId } from "./common.ts";
import type { MarkShape } from "./style.ts";

/** What a field holds. `id` is another item's id; `choice` is one of `values`. */
export type FieldKind = "text" | "number" | "boolean" | "date" | "json" | "id" | "choice";

export interface FieldDef {
  kind: FieldKind;
  /** For `choice`: the values it may take. */
  values?: string[];
  /** One line on what it means. */
  doc?: string;
}

/**
 * The fields every base has, so every item can be named, noted and moved:
 * `title` (text), `note` (text), `status` (one of its base's statuses).
 * A base or flavour doesn't declare them again.
 */
export const COMMON: Record<string, FieldDef> = {
  title: { kind: "text", doc: "A name of a few words." },
  note: { kind: "text", doc: "What else there is to say, short." },
  status: { kind: "choice", doc: "One of its base's statuses." },
};

/** Statuses, open first. A new item takes the first open one. */
export interface Statuses {
  open: string[];
  closed: string[];
}

/** A base: a kind of item by behaviour. Its statuses are the only ones its flavours have. */
export interface BaseDef {
  name: string;
  doc?: string;
  statuses: Statuses;
  fields: Record<string, FieldDef>;
}

/**
 * A flavour: a base with fields added, nothing else. It starts as a trial
 * (`trial` absent or true) and is kept by its record; a plugin that ships a
 * flavour already kept says `trial: false`.
 */
export interface FlavourDef {
  name: string;
  base: string;
  doc?: string;
  fields: Record<string, FieldDef>;
  trial?: boolean;
}

/**
 * A kind of link. `from` and `to` name the bases its ends may be (a
 * flavour counts as its base); absent, any. A link's own fields are few.
 */
export interface LinkDef {
  name: string;
  doc?: string;
  from?: string[];
  to?: string[];
  fields?: Record<string, FieldDef>;
}

/** A type as the broker resolves it: a base, or a flavour with its base's statuses and all its fields. */
export interface TypeInfo {
  name: string;
  /** The base's name; for a base, its own. */
  base: string;
  doc?: string;
  statuses: Statuses;
  /** Every field it has: the common ones, its base's, then its own. */
  fields: Record<string, FieldDef>;
  /** A flavour on trial. Bases are never on trial. */
  trial: boolean;
  /** The plugin that defined it. */
  plugin: PluginId;
}

export interface LinkInfo extends LinkDef {
  plugin: PluginId;
}

/** `types.define`. Each returns the disposer that takes the definition back. */
export interface TypesDefine {
  /** A taken name (of any base, flavour or link) is refused. */
  base(def: BaseDef): Dispose;
  /**
   * Refused when its base isn't defined now, or when it declares a field
   * its base (or every base) already has: a flavour adds, never redefines.
   * A flavour whose base goes, goes with it from `types.read`, and comes
   * back if the base does.
   */
  flavour(def: FlavourDef): Dispose;
  link(def: LinkDef): Dispose;
}

/** `types.read`. */
export interface TypesRead {
  /** Every type and link defined now. Synchronous, so a page can keep a copy. */
  all(): { types: TypeInfo[]; links: LinkInfo[] };
  /** One type or link by name. */
  get(name: string): TypeInfo | LinkInfo | undefined;
  /** Calls `on` when anything is defined or taken back. */
  watch(on: () => void): Dispose;
}

/**
 * `types.mark`, edition 10: the shape each base is drawn in. The plugin that
 * defines a base names its shape; a base none names takes the first shape
 * no base holds (MARK_SHAPES order, bases in the order they are defined),
 * round again once all are held.
 */
export interface TypesMark {
  /**
   * Draws `base` as `shape`. The base need not be defined yet. Refused when
   * another base holds that shape now, or when `base` is named already.
   */
  mark(base: string, shape: MarkShape): Dispose;
  /** Every base defined now, by name, and its shape. */
  marks(): Record<string, MarkShape>;
  /** Calls `on` when a mark, or a base, comes or goes. */
  watch(on: () => void): Dispose;
}

/**
 * `types.acyclic`, edition 11: kinds of link that may never close a loop.
 * A plugin holds a kind of link acyclic; the schema plugin then refuses a
 * change set whose links of that kind would form a cycle (`schema.cycle`).
 * Links already on the graph are not judged until a set touches them.
 */
export interface TypesAcyclic {
  /** Holds links of kind `link` acyclic. The kind need not be defined yet; several plugins may hold the same kind. */
  hold(link: string): Dispose;
  /** Every kind of link held acyclic now. */
  held(): string[];
  /** Calls `on` when a kind is held or let go. */
  watch(on: () => void): Dispose;
}

export interface Capabilities {
  "types.define": TypesDefine;
  "types.read": TypesRead;
  "types.mark": TypesMark;
  "types.acyclic": TypesAcyclic;
}

export const capabilities: Capability[] = [
  { key: "types.define", since: 1, doc: "Defines a base, a flavour of one, or a kind of link." },
  { key: "types.read", since: 1, doc: "The bases, flavours and links defined now, resolved, and when they change." },
  { key: "types.mark", since: 10, doc: "The shape each base is drawn in: named by its plugin, else the first shape no base holds." },
  { key: "types.acyclic", since: 11, doc: "Kinds of link held acyclic: the schema plugin refuses a change that would close a loop of one." },
];
