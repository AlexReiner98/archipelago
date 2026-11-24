/**
 * action: the one way anyone changes anything. See action.md.
 */
import type { ChangeSetId, Committed, Fact } from "./changeset.ts";
import type { Actor, Authority, Caller, Capability, Dispose, Id, Json, PackId, Refusal } from "./common.ts";

/** A JSON Schema (2020-12) object. Kept loose here; the schema pack checks it. */
export type JsonSchema = { [key: string]: Json };

/**
 * What an action is given while it runs. Nothing here grants a capability:
 * an action that reads the graph has its pack inject `graph.read`.
 */
export interface ActionContext {
  /** Who called, from the calling context. */
  caller: Caller;
  authority: Authority;
  reason: string;
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
  /**
   * Dotted, starting with the registering pack's id (`verdict.judge`); the
   * provider refuses a name outside the caller's own.
   */
  name: string;
  /** One line for a person or an agent choosing it. */
  title: string;
  doc?: string;
  input: JsonSchema;
  output?: JsonSchema;
  /** Throws `Refused` to say no. Returns what the caller gets back. */
  run(input: I, ctx: ActionContext): Promise<O>;
}

/**
 * A call, from a person through a UI, an agent through a tool, or a pack.
 * Who is calling isn't part of it: the action pack reads the actor, the run
 * and the pack from the calling context (`Caller` in common.ts).
 */
export interface Invocation {
  action: string;
  input: Json;
  /** On whose say-so: varies call by call, so it is said here. */
  authority: Authority;
  reason: string;
}

export type Outcome<O extends Json = Json> =
  | { ok: true; output: O; change?: ChangeSetId; committed?: Committed }
  | { ok: false; refused: Refusal };

/**
 * Edition 11: how to fix an input that doesn't fit an action's declared
 * `input`. A refusal with code `action.input` carries an `InputRefusal` as
 * its `detail`, one fix per place that failed, so the caller can correct
 * its next call without guessing.
 */
export interface InputFix {
  /** Where, as a JSON Pointer into the input: `""` the input itself, `/title`, `/links/0/to`. */
  path: string;
  /** What the schema wants there, in words: `a string`, `one of todo, done`, `not here`. */
  expected: string;
  /** A value that would pass there; null for a key that should go. */
  example: Json;
}

/** The `detail` of an `action.input` refusal (edition 11). */
export interface InputRefusal {
  fix: InputFix[];
  /** The input that was given, with every fix applied: what to send instead. */
  input: Json;
}

/** What the registry tells callers about an action. */
export interface ActionInfo {
  name: string;
  title: string;
  doc?: string;
  input: JsonSchema;
  output?: JsonSchema;
  /** The pack that registered it, from its context. */
  pack: PackId;
}

/** `action.register`. */
export interface ActionRegister {
  /**
   * Declares an action, as the calling pack's. A taken name is refused. An
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

/** A test's word: the test item, and the version of its inputs its result is for. */
export interface Attestation {
  test: Id;
  version: string;
}

/**
 * `action.attest`, edition 11: a change made on a test's word, neither a
 * person's nor an agent's. It runs an action as `action.invoke` does, but
 * the change set's actor is the test (`test:<id>`, of kind agent, since no
 * person decided it) and its authority is the test's at its version
 * (`of: "agent"`, basis `test <id> at <version>`). The change set's header
 * keeps its shape; `attested` reads the attestation back out of it.
 * Refused when the test isn't on the graph.
 */
export interface ActionAttest {
  invoke<O extends Json = Json>(call: { action: string; input: Json; attest: Attestation; reason: string }): Promise<Outcome<O>>;
}

const ATTESTED = /^test (\S+) at (\S+)$/;

/** The attestation a change set was made on (`action.attest`), or undefined if a person or an agent made it. */
export function attested(header: { actor: Actor; authority: Authority }): Attestation | undefined {
  const m = header.authority.of === "agent" ? ATTESTED.exec(header.authority.basis ?? "") : null;
  if (!m || header.actor.id !== `test:${m[1]}`) return undefined;
  return { test: m[1]!, version: m[2]! };
}

export interface Capabilities {
  "action.register": ActionRegister;
  "action.list": ActionList;
  "action.invoke": ActionInvoke;
  "action.attest": ActionAttest;
}

export const capabilities: Capability[] = [
  { key: "action.register", since: 1, doc: "Declares an action that persons, agents and packs can invoke." },
  { key: "action.list", since: 1, doc: "The declared actions, with their input and output schemas." },
  { key: "action.invoke", since: 1, doc: "Runs an action; everything it writes becomes one change set, applied or refused whole." },
  { key: "action.attest", since: 11, doc: "Runs an action on a test's word at a version: the change set's actor is the test, its authority the test's." },
];
