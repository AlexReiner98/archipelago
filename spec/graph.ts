/**
 * graph: bounded reads, live watch, the write chain. See graph.md.
 */
import type { Committed, Proposed } from "./changeset.ts";
import type { Capability, Cursor, Dispose, Id, Json, Page, PageRequest, PackId } from "./common.ts";

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

/** `graph.read`. Every read is bounded: by ids given, or by a page. */
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

/** `graph.watch`. */
export interface GraphWatch {
  /**
   * Calls `on` with each committed change set that touches the filter, in
   * commit order, after it is applied. With `after`, first catches up from
   * there. Returns the disposer that stops it.
   */
  watch(filter: WatchFilter, on: (change: Committed, cursor: Cursor) => void): Dispose;
}

/**
 * One stage of the write chain. It sees the proposed set and calls `next`
 * to pass it on; it may refuse by throwing `Refused`, or act after `next`
 * returns (as history does, journalling only what was applied). It may not
 * change the facts: a stage that wants a different change refuses and says
 * what would pass.
 */
export type Stage = (change: Proposed, next: (change: Proposed) => Promise<Committed>) => Promise<Committed>;

/**
 * Where a stage runs. The order is fixed by the spec; within one phase,
 * stages run in the order of `rank` (low first), then pack id.
 * - `check`: may refuse. The schema pack is here.
 * - `record`: sees what was applied. The history pack is here.
 */
export type Phase = "check" | "record";

export interface StageDef {
  pack: PackId;
  phase: Phase;
  rank?: number;
  run: Stage;
}

/** `graph.stage`. */
export interface GraphStage {
  /** Adds a stage to the chain. */
  stage(def: StageDef): Dispose;
}

/** `graph.commit`: the chain's entry. Only the action pack should be given it. */
export interface GraphCommit {
  /** Sends a change set down the chain to the store. */
  commit(change: Proposed): Promise<Committed>;
}

/** The context keys this file defines, and what each one is. */
export interface Capabilities {
  "graph.read": GraphRead;
  "graph.watch": GraphWatch;
  "graph.stage": GraphStage;
  "graph.commit": GraphCommit;
}

export const capabilities: Capability[] = [
  { key: "graph.read", since: 1, doc: "Bounded reads of items, links and committed change sets." },
  { key: "graph.watch", since: 1, doc: "Each committed change set touching a filter, in order, resumable from a cursor." },
  { key: "graph.stage", since: 1, doc: "Adds a check or record stage to the write chain." },
  { key: "graph.commit", since: 1, doc: "Sends a change set (changeset format, edition 1) down the write chain; all or nothing." },
];
