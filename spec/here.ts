/**
 * here 0.1.0: shared ephemeral state. See here.md.
 */
import type { JsonSchema } from "./action.ts";
import type { Actor, ContractVersion, Dispose, Json, PackId } from "./common.ts";

export const contract: ContractVersion<"here"> = { name: "here", version: "0.1.0" };

/**
 * - `page`: one open page. Two tabs can look at different things.
 * - `person`: everything a person has open, and the agents working for
 *   them, so an agent can point the person's view at something.
 */
export type Scope = "page" | "person";

export interface KeyDef {
  /** Dotted, starting with the declaring pack's id, or one of the spec's keys. */
  key: string;
  pack: PackId;
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
} as const;

export interface Change {
  key: string;
  value: Json | undefined;
  by: Actor | { pack: PackId };
}

/** The service, provided as `here@0`. */
export interface Here {
  /** Declares a key beyond the spec's. A taken key is refused. */
  declare(def: KeyDef): Dispose;
  get<T extends Json>(key: string): T | undefined;
  /** Sets or (with `undefined`) clears a key. Not an action: see here.md. */
  set(key: string, value: Json | undefined, by: Change["by"]): void;
  /** Calls `on` with each change to the key, starting with its value now. */
  watch(key: string, on: (change: Change) => void): Dispose;
}
