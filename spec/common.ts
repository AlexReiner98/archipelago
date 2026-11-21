/**
 * Words every contract shares. Not a capability: these are the
 * types the capabilities are written in, fixed with the edition.
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

/**
 * What a provider knows about whoever called it, read from the calling
 * context, never passed as an argument (see "What the spec asks of the
 * runtime" in spec/README.md). Callers can't claim to be someone else.
 */
export interface Caller {
  /** The pack whose context made the call. */
  pack: PackId;
  /**
   * Who is acting through that context, set by interception (Cordis
   * `ctx.intercept`) where a person or agent comes in: sign-in for a
   * person's page, the harness adapter for a run. Absent: the pack itself.
   */
  actor?: Actor;
  /** The run the call belongs to, set the same way. */
  run?: string;
  /**
   * The calling pack's place in the config tree, as the path of entry
   * indices from the root. Contributions are ordered by it: see Order.
   */
  position: number[];
}

/**
 * The metadata keys interception sets on a context, so every provider
 * reads who is acting the same way.
 */
export const META = { actor: "actor", run: "run" } as const;

/**
 * How every broker orders what packs contribute (stages, nodes, fills):
 * by the contributing pack's `position` in the config tree, depth first,
 * then by the order the pack registered them in. No ranks or priorities:
 * to change an order, move the entry in the config tree.
 */
export function byPosition(a: Caller, b: Caller): number {
  const n = Math.min(a.position.length, b.position.length);
  for (let i = 0; i < n; i++) {
    const d = a.position[i]! - b.position[i]!;
    if (d !== 0) return d;
  }
  return a.position.length - b.position.length;
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
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(refusal.message);
    this.refusal = refusal;
    this.name = "Refused";
  }
}

/**
 * An edition of the spec: 1, 2, 3… The spec as a whole is versioned, not
 * the packs that use it. An edition adds capabilities or vocabulary, or
 * retires capabilities; it never changes what one means.
 */
export type Edition = number;

/** The edition these files are. */
export const EDITION: Edition = 6;

/**
 * A capability: one key in the Cordis context, and what it means. A pack
 * asks for capabilities (its `inject`), never for a version of a pack, and
 * whichever pack provides the key now satisfies it. Once an edition is
 * accepted, a capability's meaning is fixed for good. A change that old
 * users couldn't ignore is a new capability with a new key, and the old one
 * is retired, not altered. See spec/README.md.
 */
export interface Capability {
  /** The context key: `graph.read`. */
  key: string;
  /** What providing it promises, in a sentence. The types say the rest. */
  doc: string;
  /** The edition it arrived in. */
  since: Edition;
  /** The edition it was retired in, and what replaces it. */
  retired?: { in: Edition; by?: string };
}

/**
 * A vocabulary entry (a place, a node kind, an event kind). Vocabularies
 * are open: an edition can add entries, and every consumer ignores entries
 * it doesn't know rather than failing on them.
 */
export interface Term {
  term: string;
  doc: string;
  since: Edition;
}
