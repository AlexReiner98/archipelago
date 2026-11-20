/**
 * agent 0.1.0: say, refuse, act. See agent.md.
 *
 * DRAFT: the place vocabulary is an open question to Alex on the map.
 */
import type { Actor, ContractVersion, Dispose, Id, Json, PackId, Time } from "./common.ts";
import type { GraphRead } from "./graph.ts";

export const contract: ContractVersion<"agent"> = { name: "agent", version: "0.1.0" };

/** One agent session, from its start to its end. */
export type RunId = string;

/**
 * A place: a moment in a run where the map can speak. Draft vocabulary.
 * A reached place is concrete (`tool:Bash`, `file:spec/agent.ts`); a node's
 * `at` may put `*` in the argument (`tool:*`, `file:packs/* /page/*.js`).
 */
export type Place =
  | "session_start"
  | "prompt"
  | "reply_end"
  | `tool:${string}`
  | `skill:${string}`
  | `memory:${string}`
  | `file:${string}`;

/** Places where a refusal stops what is happening. Elsewhere only `say` counts. */
export const REFUSABLE = ["prompt", "reply_end", "tool:", "file:"] as const;

/** What a node is. Draft vocabulary, grown by minor versions. */
export type NodeKind =
  | "instruction"
  | "reflex"
  | "rule"
  | "schema_check"
  | "skill"
  | "memory"
  | "tool_text";

/** What the adapter knows when it reaches places. */
export interface Moment {
  run: RunId;
  /** Every place reached at once: a tool call that edits a file reaches `tool:Edit` and `file:…`. */
  places: Place[];
  time: Time;
  /** What is happening there: the prompt's text, the tool's input, the reply. */
  input?: Json;
}

/** What a node answers at a moment. Nothing: it stays quiet. */
export type Utterance =
  | { say: string }
  | { refuse: string; code?: string };

export interface NodeContext {
  graph: GraphRead;
  run: RunInfo;
}

/** Anything said at a place. Registering one is a revertible effect. */
export interface NodeDef {
  /** `pack/name`, stable across reloads, so a run's record keeps pointing at it. */
  id: string;
  pack: PackId;
  kind: NodeKind;
  title: string;
  /** The places it listens at. */
  at: Place[];
  /** The map item it was made from, when it was made from one. */
  source?: Id;
  speak(moment: Moment, ctx: NodeContext): Utterance | null | Promise<Utterance | null>;
}

/** What the registry shows: a node without its code. The harness view's tree is these. */
export type NodeInfo = Omit<NodeDef, "speak">;

export interface RunStart {
  run: RunId;
  agent: Actor;
  /** Which harness: `claude-code`. */
  harness: string;
  title?: string;
  cwd?: string;
  /** The run that started this one. */
  parent?: RunId;
  /** The task it took on, if it says. */
  task?: Id;
}

export interface RunInfo extends RunStart {
  started: Time;
  ended?: Time;
}

/** What the map says back at a moment. */
export interface Answer {
  /** Everything said, in node order, for the adapter to hand to the agent. */
  said: { node: string; text: string }[];
  /** The first refusal from a node, if any; the adapter stops the step. */
  refused?: { node: string; text: string; code?: string };
}

/** What the agent did. */
export interface Act {
  run: RunId;
  place: Place;
  time: Time;
  /** `tool`: a tool call and its result. `reply`: the agent's reply. `prompt`: a person's message to it. */
  kind: "tool" | "reply" | "prompt";
  by: "agent" | "person";
  input?: Json;
  output?: Json;
  /** Did it work: a tool that errored, or an action that was refused, is `false`. */
  ok?: boolean;
}

/**
 * The service, provided as `agent@0`. Every say, refusal and act passes
 * through it, and it hands each one to the exchange as an event.
 */
export interface Agent {
  /** Adds a node to the registry. */
  node(def: NodeDef): Dispose;
  /** The registry: every node now loaded. */
  nodes(): NodeInfo[];

  /** A run starts. Reaching `session_start` follows. */
  begin(run: RunStart): Promise<RunInfo>;
  /** The adapter reached places: asks every node listening there, in order. */
  reach(moment: Moment): Promise<Answer>;
  /** The agent did something. */
  act(act: Act): Promise<void>;
  /** A run ends. */
  end(run: RunId, time: Time): Promise<void>;
}
