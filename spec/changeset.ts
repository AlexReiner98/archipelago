/**
 * changeset: a change written in full. See changeset.md.
 *
 * A format, not a capability: it is what `graph.commit`, `graph.read` and
 * `graph.watch` carry, and it is fixed with them. A format that had to
 * change would come with new capabilities that carry it.
 */
import type { Actor, Authority, Id, Json, PluginId, Time } from "./common.ts";

/** `+` asserts a value, `-` retracts it. */
export type Op = "+" | "-";

/**
 * One fact. `field` is a field of the item `id`: `type` and, for a link,
 * `from` and `to` are fields like any other. A field holds one value at a
 * time, so changing it is a retraction of the old value then an assertion
 * of the new one.
 */
export type Fact = [op: Op, id: Id, field: string, value: Json];

/** The id of a change set, given by the graph when it is committed. */
export type ChangeSetId = string;

export interface Header {
  /** Who made it. */
  actor: Actor;
  /** On whose say-so. */
  authority: Authority;
  /**
   * The plugin whose code wrote it, and the code's hash, for provenance: which
   * code did this. Nothing depends on it; it is a record.
   */
  plugin: { id: PluginId; hash?: string };
  /** The action it was made through. */
  action: string;
  /** Why, in a sentence, as the actor gave it. */
  reason: string;
  /** When it was proposed. */
  time: Time;
  /** When this change set undoes another, that one's id. */
  undoes?: ChangeSetId;
  /** The run (agent session) it was made in, if any. */
  run?: string;
}

/** A change set before the graph has taken it. */
export interface Proposed {
  header: Header;
  facts: Fact[];
}

/** A change set the graph has applied. */
export interface Committed extends Proposed {
  id: ChangeSetId;
  /** Its place in the graph's order: strictly increasing, no gaps promised. */
  seq: number;
  /** When the graph applied it. */
  committed: Time;
}

/**
 * The inverse of a change set's facts: reversed, each op flipped. Exact
 * because every retraction carries the value it removed. A pure function,
 * so it lives in the spec.
 */
export function inverse(facts: readonly Fact[]): Fact[] {
  const out: Fact[] = [];
  for (let i = facts.length - 1; i >= 0; i--) {
    const [op, id, field, value] = facts[i]!;
    out.push([op === "+" ? "-" : "+", id, field, value]);
  }
  return out;
}
