/**
 * graph 0.1.0: bounded reads, live watch, the write chain. See graph.md.
 */
import type { Committed, Proposed } from "./changeset.ts";
import type { ContractVersion, Cursor, Dispose, Id, Json, Page, PageRequest, PackId } from "./common.ts";

export const contract: ContractVersion<"graph"> = { name: "graph", version: "0.1.0" };

/** No read returns more than this many items, whatever it asks for. */
export const LIMIT_MAX = 500;

/** An item: an id, its type, and its other fields. */
export interface Item {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}

/** A link: an item whose `from` and `to` fields are set. */
export interface Link extends Item {
  from: Id;
  to: Id;
}

export type Direction = "out" | "in" | "both";

/** The read side. Every read is bounded: by ids given, or by a page. */
export interface GraphRead {
  /** At most LIMIT_MAX ids. A missing id gives `null` in its place. */
  get(ids: Id[]): Promise<(Item | null)[]>;
  /** Items of one type, in a stable order. */
  of(type: string, page?: PageRequest): Promise<Page<Item>>;
  /** Links at an item, optionally of one link type. */
  links(id: Id, opts: { type?: string; dir: Direction }, page?: PageRequest): Promise<Page<Link>>;
  /** Change sets committed after a cursor, in order. No cursor: from the oldest kept. */
  since(page?: PageRequest): Promise<Page<Committed>>;
  /** Where the graph is now: `since({ after: now() })` returns only what comes next. */
  now(): Promise<Cursor>;
}

/** What a watcher wants to hear about. Every key narrows; none means all. */
export interface WatchFilter {
  ids?: Id[];
  types?: string[];
  fields?: string[];
  /** Resume after this cursor rather than from now. */
  after?: Cursor;
}

export interface GraphWatch {
  /**
   * Calls `on` with each committed change set that touches the filter, in
   * commit order, after it is applied. With `after`, first catches up from
   * there. Returns the disposer that stops it.
   */
  watch(filter: WatchFilter, on: (change: Committed, cursor: Cursor) => void): Dispose;
}

/**
 * The write chain. A change set travels action → schema → history → graph
 * and each stage is a stage registered here. A stage sees the proposed set
 * and calls `next` to pass it on; it may refuse by throwing `Refused`, or
 * act after `next` returns (as history does, journalling only what was
 * applied). Stages may not change the facts: a stage that wants a different
 * change refuses and says what would pass.
 */
export type Stage = (change: Proposed, next: (change: Proposed) => Promise<Committed>) => Promise<Committed>;

/**
 * Where a stage runs. The order is fixed by the contract; within one phase,
 * stages run in the order of `rank` (low first), then pack id.
 * - `check`: may refuse. The schema pack is here.
 * - `record`: sees what was applied. The history pack is here.
 * The action service is the chain's entry; the graph's store is its end.
 */
export type Phase = "check" | "record";

export interface StageDef {
  pack: PackId;
  phase: Phase;
  rank?: number;
  run: Stage;
}

export interface GraphWrite {
  /** Adds a stage to the chain. */
  stage(def: StageDef): Dispose;
  /**
   * Sends a change set down the chain. Only the action service calls this
   * (see action.md); anything else writing here breaks the contract.
   */
  commit(change: Proposed): Promise<Committed>;
}

/** The whole service, provided as `graph@0`. */
export interface Graph extends GraphRead, GraphWatch, GraphWrite {}
