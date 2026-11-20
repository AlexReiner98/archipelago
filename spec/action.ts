/**
 * action 0.1.0: the one way anyone changes anything. See action.md.
 */
import type { ChangeSetId, Committed, Fact } from "./changeset.ts";
import type { Actor, Authority, ContractVersion, Dispose, Json, PackRef, Refusal } from "./common.ts";
import type { GraphRead } from "./graph.ts";

export const contract: ContractVersion<"action"> = { name: "action", version: "0.1.0" };

/** A JSON Schema (2020-12) object. Kept loose here; the schema pack checks it. */
export type JsonSchema = { [key: string]: Json };

/** What an action is given while it runs. */
export interface ActionContext {
  actor: Actor;
  authority: Authority;
  reason: string;
  run?: string;
  /** Reads see the graph as it is, plus the facts this call has written so far. */
  graph: GraphRead;
  /**
   * Adds facts to this call's change set. Nothing is applied until the
   * outermost action returns; then all of it is, as one change set, or none.
   */
  write(facts: Fact[]): void;
  /** Calls another action inside this one. Its facts join this change set. */
  call<O extends Json = Json>(name: string, input: Json): Promise<O>;
}

export interface ActionDef<I extends Json = Json, O extends Json = Json> {
  /** Dotted, starting with the pack's id: `graph.create`, `verdict.judge`. */
  name: string;
  /** The action's own version; its input and output change with it. */
  version: string;
  /** One line for a person or an agent choosing it. */
  title: string;
  doc?: string;
  input: JsonSchema;
  output?: JsonSchema;
  /** Throws `Refused` to say no. Returns what the caller gets back. */
  run(input: I, ctx: ActionContext): Promise<O>;
}

/** A call, from a person through a UI, an agent through a tool, or a pack. */
export interface Invocation {
  action: string;
  input: Json;
  actor: Actor;
  authority: Authority;
  reason: string;
  run?: string;
}

export type Outcome<O extends Json = Json> =
  | { ok: true; output: O; change?: ChangeSetId; committed?: Committed }
  | { ok: false; refused: Refusal };

/** What the registry tells callers about an action. */
export interface ActionInfo {
  name: string;
  version: string;
  title: string;
  doc?: string;
  input: JsonSchema;
  output?: JsonSchema;
  pack: PackRef;
}

/** The service, provided as `action@0`: a broker of every pack's actions. */
export interface Actions {
  /** Declares an action. A second action of the same name is refused. */
  register(def: ActionDef<any, any>): Dispose;
  /** Every declared action, for a UI's menu or an agent's tool list. */
  list(): ActionInfo[];
  /** Runs an action. Never throws for a refusal: returns `{ ok: false }`. */
  invoke<O extends Json = Json>(call: Invocation): Promise<Outcome<O>>;
}

/**
 * The one action name the spec reserves. Its provider (the history pack)
 * undoes the committed change set it is given.
 */
export const UNDO = "history.undo";
export interface UndoInput {
  change: ChangeSetId;
  [key: string]: Json;
}
