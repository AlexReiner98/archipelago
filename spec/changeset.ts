/**
 * changeset 0.1.0: a change written in full. See changeset.md.
 */
import type { Actor, Authority, ContractVersion, Id, Json, PackRef, Time } from "./common.ts";

export const contract: ContractVersion<"changeset"> = { name: "changeset", version: "0.1.0" };

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
   * The pack whose code wrote it. For a change a person or agent made
   * through an action, the pack that provides the action.
   */
  pack: PackRef;
  /** The action it was made through, with the version of it. */
  action: { name: string; version: string };
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
 * so it lives in the contract.
 */
export function inverse(facts: readonly Fact[]): Fact[] {
  const out: Fact[] = [];
  for (let i = facts.length - 1; i >= 0; i--) {
    const [op, id, field, value] = facts[i]!;
    out.push([op === "+" ? "-" : "+", id, field, value]);
  }
  return out;
}
