/**
 * Words every contract shares. Not a contract of its own: it is versioned
 * with the spec as a whole, and a change here is a change to every contract
 * that imports it.
 */

/** Any value that survives JSON. Facts, inputs and events carry only these. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** An id of an item or link in the graph. Opaque to everyone but the graph pack. */
export type Id = string;

/** A pack's id, as its manifest names it: `exchange`, `verdict`, `claude-code`. */
export type PackId = string;

/** A pack and the exact version that did something. */
export interface PackRef {
  id: PackId;
  version: string;
}

/** An ISO 8601 time in UTC, `2026-11-20T13:02:37.297Z`. */
export type Time = string;

/** Who did it: a person or an agent, by their id in the graph. */
export interface Actor {
  id: Id;
  kind: "person" | "agent";
}

/**
 * On whose say-so. `human` when a person told the actor to do it or decided
 * it (`basis` says what they said and where); `agent` for the actor's own
 * judgement (`basis` says what it rests on). Recorded, never a gate.
 */
export interface Authority {
  of: "human" | "agent";
  basis?: string;
}

/**
 * Undoes what a registration did. Every call in these contracts that adds
 * something to the system (a node, an action, a watcher, a slot fill)
 * returns one. The runtime ties it to the calling pack, so when the pack
 * unloads everything it registered goes, and calling it twice is harmless.
 * It is the inverse of a Cordis effect (`ctx.effect` returns it), and like
 * one it may be async.
 */
export type Dispose = () => void | Promise<void>;

/** An opaque position to read on from. Only the pack that gave it reads it. */
export type Cursor = string;

/** A bounded page. `next` is absent on the last page. */
export interface Page<T> {
  items: T[];
  next?: Cursor;
}

/** What a caller asks of a page. `limit` is capped by the contract that reads. */
export interface PageRequest {
  limit?: number;
  after?: Cursor;
}

/**
 * Why something was refused. `code` is stable and machine-readable
 * (`schema.field_unknown`, `graph.conflict`); `message` is for a person or
 * an agent and says what would make it pass.
 */
export interface Refusal {
  code: string;
  message: string;
  /** Who refused: the pack, and the node or rule inside it if there is one. */
  by: { pack: PackId; node?: string };
  detail?: Json;
}

/** Thrown, or returned as `{ refused }`, by any contract that can refuse. */
export class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message);
    this.name = "Refused";
  }
}

/**
 * How every contract states its version. `name` is the service the runtime
 * provides it under; `version` is semver. See spec/README.md for what each
 * part of the number promises.
 */
export interface ContractVersion<N extends string = string> {
  name: N;
  version: `${number}.${number}.${number}`;
}
