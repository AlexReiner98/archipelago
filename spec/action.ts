/**
 * action: the one way anyone changes anything. See action.md.
 */
import type { ChangeSetId, Committed, Fact } from "./changeset.ts";
import type { Actor, Authority, Capability, Dispose, Json, PackId, Refusal } from "./common.ts";

/** A JSON Schema (2020-12) object. Kept loose here; the schema pack checks it. */
export type JsonSchema = { [key: string]: Json };

/**
 * What an action is given while it runs. Nothing here grants a capability:
 * an action that reads the graph has its pack inject `graph.read`.
 */
export interface ActionContext {
  actor: Actor;
  authority: Authority;
  reason: string;
  run?: string;
  /**
   * Adds facts to this call's change set. Nothing is applied until the
   * outermost action returns; then all of it is, as one change set, or none.
   */
  write(facts: Fact[]): void;
  /** The facts this call has written so far, its own included. */
  written(): readonly Fact[];
  /** Calls another action inside this one. Its facts join this change set. */
  call<O extends Json = Json>(name: string, input: Json): Promise<O>;
}

export interface ActionDef<I extends Json = Json, O extends Json = Json> {
  /** Dotted, starting with the pack's id: `graph.create`, `verdict.judge`. */
  name: string;
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
  title: string;
  doc?: string;
  input: JsonSchema;
  output?: JsonSchema;
  pack: PackId;
}

/** `action.register`. */
export interface ActionRegister {
  /**
   * Declares an action. A second action of the same name is refused. An
   * action whose input or output must change incompatibly gets a new name;
   * the old one is retired, not altered.
   */
  register(def: ActionDef<any, any>): Dispose;
}

/** `action.list`. */
export interface ActionList {
  /** Every declared action, for a UI's menu or an agent's tool list. */
  list(): ActionInfo[];
  /** Calls `on` when actions come or go. */
  watch(on: () => void): Dispose;
}

/** `action.invoke`. */
export interface ActionInvoke {
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

export interface Capabilities {
  "action.register": ActionRegister;
  "action.list": ActionList;
  "action.invoke": ActionInvoke;
}

export const capabilities: Capability[] = [
  { key: "action.register", since: 1, doc: "Declares an action that persons, agents and packs can invoke." },
  { key: "action.list", since: 1, doc: "The declared actions, with their input and output schemas." },
  { key: "action.invoke", since: 1, doc: "Runs an action; everything it writes becomes one change set, applied or refused whole." },
];
