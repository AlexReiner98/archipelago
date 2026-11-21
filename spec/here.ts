/**
 * here: shared ephemeral state. See here.md.
 */
import type { JsonSchema } from "./action.ts";
import type { Actor, Capability, Dispose, Json, PackId } from "./common.ts";

/**
 * - `page`: one open page. Two tabs can look at different things.
 * - `person`: everything a person has open, and the agents working for
 *   them, so an agent can point the person's view at something.
 */
export type Scope = "page" | "person";

export interface KeyDef {
  /** Dotted, starting with the declaring pack's id; the provider refuses a key outside it. */
  key: string;
  scope: Scope;
  value?: JsonSchema;
  doc?: string;
}

/** The keys the spec declares, so packs that never met agree on them. */
export const KEYS = {
  /** The item being looked at: an Id. */
  item: "here.item",
  /** The run being looked at: a RunId. */
  run: "here.run",
  /** The node being looked at: a node id. */
  node: "here.node",
  /** The exchange event being looked at: an event id. */
  event: "here.event",
  /** The fill shown in the region `center`, as `pack/name`: the frame sets it (edition 7). */
  view: "here.view",
} as const;

export interface Change {
  key: string;
  value: Json | undefined;
  /** Who set it: the pack, and the actor if its context carries one. */
  by: { pack: PackId; actor?: Actor };
}

/** `here.declare`. */
export interface HereDeclare {
  /** Declares a key beyond the spec's, as the calling pack's. A taken key is refused. */
  declare(def: KeyDef): Dispose;
}

/** `here.read`. */
export interface HereRead {
  get<T extends Json>(key: string): T | undefined;
  /** Calls `on` with each change to the key, starting with its value now. */
  watch(key: string, on: (change: Change) => void): Dispose;
}

/** `here.set`. */
export interface HereSet {
  /** Sets or (with `undefined`) clears a key. Not an action: see here.md. */
  set(key: string, value: Json | undefined): void;
}

export interface Capabilities {
  "here.declare": HereDeclare;
  "here.read": HereRead;
  "here.set": HereSet;
}

export const capabilities: Capability[] = [
  { key: "here.declare", since: 1, doc: "Declares a key of shared ephemeral state, with its scope." },
  { key: "here.read", since: 1, doc: "A key's value now, and each change to it." },
  { key: "here.set", since: 1, doc: "Sets or clears a key." },
];
