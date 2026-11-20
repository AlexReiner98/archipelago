/**
 * agent: say, refuse, act. See agent.md.
 *
 * The spec owns the place vocabulary (Alex, 20 Nov 2026); which places are
 * in edition 1 is still being settled.
 */
import type { Actor, Capability, Dispose, Id, Json, PackId, Term, Time } from "./common.ts";

/** One agent session, from its start to its end. */
export type RunId = string;

/**
 * A place: a moment in a run where the map can speak. A reached place is
 * concrete (`tool:Bash`, `file:spec/agent.ts`); a node's `at` may put `*`
 * in the argument (`tool:*`). The vocabulary is open (see PLACES): a node
 * may listen at a place no adapter reaches yet, and stays quiet until one
 * does.
 */
export type Place = string;

/** Draft vocabulary. `refusable`: a refusal there stops what is happening. */
export const PLACES: (Term & { refusable: boolean })[] = [
  { term: "session_start", since: 1, refusable: false, doc: "The run begins." },
  { term: "prompt", since: 1, refusable: true, doc: "A person's message reaches the agent." },
  { term: "tool:<name>", since: 1, refusable: true, doc: "The agent is about to call a tool." },
  { term: "tool_result:<name>", since: 1, refusable: false, doc: "A tool has returned; what it returned is the moment's input." },
  { term: "file:<path>", since: 1, refusable: true, doc: "A tool is about to touch that file; reached with its tool:." },
  { term: "skill:<name>", since: 1, refusable: false, doc: "A skill is loaded." },
  { term: "memory:<scope>", since: 1, refusable: false, doc: "Memory of that scope is loaded." },
  { term: "reply_end", since: 1, refusable: true, doc: "The agent is about to finish its reply; refusing keeps it going." },
];

/** What a node is. Open vocabulary, like places. */
export const NODE_KINDS: Term[] = [
  { term: "instruction", since: 1, doc: "Standing words for every run." },
  { term: "reflex", since: 1, doc: "Words said when a condition holds at a place." },
  { term: "rule", since: 1, doc: "A check that can refuse." },
  { term: "schema_check", since: 1, doc: "The schema's refusal, said to the agent." },
  { term: "skill", since: 1, doc: "A skill's text." },
  { term: "memory", since: 1, doc: "Remembered words." },
  { term: "tool_text", since: 1, doc: "A tool's description or result text." },
];

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
export type Utterance = { say: string } | { refuse: string; code?: string };

/**
 * Anything said at a place. Registering one is a revertible effect. A node
 * that reads the map has its pack inject `graph.read`; it is handed nothing.
 */
export interface NodeDef {
  /** Unique within the pack, stable across reloads. */
  name: string;
  kind: string;
  title: string;
  /** The places it listens at. */
  at: Place[];
  /** The map item it was made from, when it was made from one. */
  source?: Id;
  speak(moment: Moment, run: RunInfo): Utterance | null | Promise<Utterance | null>;
}

/** A node without its code. The harness view's tree is these. */
export interface NodeInfo extends Omit<NodeDef, "speak"> {
  /** `pack/name`: what exchange events and verdicts point at. */
  id: string;
  /** The pack that registered it, from its context. */
  pack: PackId;
}

/**
 * The adapter calls `agent.run` from a context intercepted for the run
 * (`META.actor` the agent, `META.run` the run id), one child context per
 * run, so every call in it is the run's without saying so.
 */
export interface RunStart {
  run: RunId;
  /** The agent, as its context says. */
  agent: Actor;
  /** Which harness: `claude-code`. */
  harness: string;
  /** The places this adapter can reach, as terms of PLACES. */
  reaches: string[];
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
  /**
   * Everything said, for the adapter to hand to the agent, in config-tree
   * order of the nodes' packs, then the order each pack registered them.
   */
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

/** `agent.node`: add a node, as the calling pack's. */
export interface AgentNode {
  node(def: NodeDef): Dispose;
}

/** `agent.tree`: the registry, every node loaded now. */
export interface AgentTree {
  nodes(): NodeInfo[];
  /** Calls `on` when nodes come or go. */
  watch(on: () => void): Dispose;
}

/**
 * `agent.run`: the adapter's side. Every say, refusal and act passes
 * through here, and the provider hands each one to `exchange.append`.
 */
export interface AgentRun {
  /** A run starts. Reaching `session_start` follows. */
  begin(run: RunStart): Promise<RunInfo>;
  /** The adapter reached places: asks every node listening there, in order. */
  reach(moment: Moment): Promise<Answer>;
  /** The agent did something. */
  act(act: Act): Promise<void>;
  /** A run ends. */
  end(run: RunId, time: Time): Promise<void>;
}

export interface Capabilities {
  "agent.node": AgentNode;
  "agent.tree": AgentTree;
  "agent.run": AgentRun;
}

export const capabilities: Capability[] = [
  { key: "agent.node", since: 1, doc: "Adds a node that may say or refuse at places." },
  { key: "agent.tree", since: 1, doc: "Every node loaded now, without its code." },
  { key: "agent.run", since: 1, doc: "Begin, reach places, act, end: the adapter's way in. Everything is recorded on the exchange." },
];
