/**
 * agent: say, refuse, act. See agent.md.
 *
 * The spec owns the place vocabulary. Edition 1 has six places (20 Nov
 * 2026): the ones an adapter can both reach and speak at. Edition 2
 * adds `skill:` and `memory:` (20 Nov 2026), where the map speaks
 * through the files it writes. Edition 3 (20 Nov 2026) adds `compact`
 * and the person's acts, `decision` and `notice`. Edition 4 (20 Nov
 * 2026) adds a node's `repeat` and a moment's `again`: the same words are
 * said once per context. Edition 5 (20 Nov 2026) adds a run's
 * `facts`, which any pack can add to (`agent.facts`), and a gate where a
 * pack says "not this node for this run" (`agent.gate`).
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

/** The places, each with the edition it came in. `refusable`: a refusal there stops what is happening. */
export const PLACES: (Term & { refusable: boolean })[] = [
  { term: "session_start", since: 1, refusable: false, doc: "The run begins." },
  { term: "prompt", since: 1, refusable: true, doc: "A person's message reaches the agent." },
  { term: "tool:<name>", since: 1, refusable: true, doc: "The agent is about to call a tool." },
  { term: "tool_result:<name>", since: 1, refusable: false, doc: "A tool has returned; what it returned is the moment's input." },
  { term: "file:<path>", since: 1, refusable: true, doc: "A tool is about to touch that file; reached with its tool:." },
  { term: "reply_end", since: 1, refusable: true, doc: "The agent is about to finish its reply; refusing keeps it going." },
  // Edition 2 (20 Nov 2026): skills and memory are written by the map,
  // so the map speaks there through the files the harness loads.
  { term: "skill:<name>", since: 2, refusable: false, doc: "The harness loads a skill's text, which the map wrote; what it loaded is the moment's input." },
  { term: "memory:<scope>/<path>", since: 2, refusable: false, doc: "The harness loads a memory file (scope: project, local, user, auto, managed; `~` for home), which the map wrote; what it loaded is the moment's input." },
  // Edition 3 (20 Nov 2026): every way an agent and the map meet is modelled.
  { term: "compact", since: 3, refusable: false, doc: "The harness is about to compact the run's context: what was said before is gone from it, so a node said again after is a re-saying. The moment's input says what started it (`trigger`)." },
];

/**
 * What an act is (`Act.kind`). Edition 3 adds `decision` and `notice`, the
 * person's side of a run.
 */
export const ACT_KINDS: Term[] = [
  { term: "tool", since: 1, doc: "A tool call and its result, by the agent." },
  { term: "reply", since: 1, doc: "The agent's reply." },
  { term: "prompt", since: 1, doc: "A person's message to the agent." },
  { term: "decision", since: 3, doc: "A person answered the harness about a tool call, at its `tool:` place: output `allow` or `deny`; a denial is `ok: false`." },
  { term: "notice", since: 3, doc: "The harness asked the person for something (a permission, input) and the run waits on them, at `prompt`: input `{type, message}`." },
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
  /** Edition 4: the agent asked to hear the place: say even what this context already heard. */
  again?: boolean;
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
  /**
   * Edition 4. `once` (the default): the same words from this node are said
   * once per context, and again only after a `compact` or when the moment
   * asks `again`. `every`: said every time its place is reached. A refusal is
   * never held back.
   */
  repeat?: "once" | "every";
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
  /** Edition 5: facts the adapter knows (a subagent's `agent_type`). */
  facts?: Facts;
}

export interface RunInfo extends RunStart {
  started: Time;
  ended?: Time;
  /**
   * Edition 5: every fact about the run, made again at each `begin`: the
   * fields above that it has (`harness`, `cwd`, `parent`, `task`), then the
   * start's own facts, then each fact source's (`agent.facts`) in
   * config-tree order. A key already set is kept.
   */
  facts?: Facts;
}

/**
 * Edition 5: what is so about a run, by name. Open-ended: any pack can add
 * a fact (a git pack reads `remote` from `cwd`), and whatever reads them
 * matches on names, never on fixed fields. A value is text or a list of it.
 */
export type Facts = Record<string, string | string[]>;

/** The facts the spec's own packs name. Open vocabulary, like places. */
export const FACTS: Term[] = [
  { term: "harness", since: 5, doc: "Which harness: `claude-code`." },
  { term: "cwd", since: 5, doc: "The folder the run works in, as the harness gives it." },
  { term: "parent", since: 5, doc: "The run that started this one." },
  { term: "task", since: 5, doc: "The item the run took on." },
  { term: "hub", since: 5, doc: "The items the task is part of, at any depth." },
  { term: "remote", since: 5, doc: "The git remote of `cwd`, as `host/owner/name`: steadier than the folder, which worktrees and machines change." },
  { term: "branch", since: 5, doc: "The git branch checked out in `cwd`." },
  { term: "repo", since: 5, doc: "The map's item for the remote." },
  { term: "profiles", since: 5, doc: "Profiles the run says it is in (the `run` tool's `profiles`)." },
  { term: "profiles_drop", since: 5, doc: "Profiles the run says it is not in (the `run` tool's `drop`)." },
  { term: "agent_type", since: 5, doc: "A subagent's type, as the harness names it." },
];

/**
 * Edition 5: a pack's way to add facts to a run. Registering one is a
 * revertible effect. Asked at each `begin`; nothing (or a throw, recorded
 * as a miss) adds nothing.
 */
export interface FactSource {
  /** Unique within the pack. */
  name: string;
  facts(run: RunInfo): Facts | null | Promise<Facts | null>;
}

/** `agent.facts`: add a fact source, as the calling pack's. */
export interface AgentFacts {
  source(def: FactSource): Dispose;
}

/**
 * Edition 5: a gate says "not this node for this run" before the node is
 * asked. Registering one is a revertible effect, like a node. At each
 * `reach`, every gate is asked about every node listening there, in
 * config-tree order; the first that answers holds the node back, and the
 * node isn't asked. The gate doesn't choose which packs are loaded.
 */
export interface GateDef {
  /** Unique within the pack. */
  name: string;
  title: string;
  /** Why the node is held back from this run, or nothing: it may speak. */
  hold(node: NodeInfo, run: RunInfo, moment: Moment): Hold | null | Promise<Hold | null>;
}

/**
 * A gate's answer: why the node is held back. A `trial` hold is only
 * recorded: the node is still asked, so a gate can be watched before it
 * holds anything.
 */
export type Hold = string | { why: string; trial?: boolean };

/** `agent.gate`: add a gate, as the calling pack's. */
export interface AgentGate {
  gate(def: GateDef): Dispose;
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
  /**
   * `tool`: a tool call and its result. `reply`: the agent's reply. `prompt`:
   * a person's message to it. Edition 3: `decision`, a person allowed or
   * denied a tool call; `notice`, the harness asked the person for something.
   */
  kind: "tool" | "reply" | "prompt" | "decision" | "notice";
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
  "agent.facts": AgentFacts;
  "agent.gate": AgentGate;
}

export const capabilities: Capability[] = [
  { key: "agent.node", since: 1, doc: "Adds a node that may say or refuse at places." },
  { key: "agent.tree", since: 1, doc: "Every node loaded now, without its code." },
  { key: "agent.run", since: 1, doc: "Begin, reach places, act, end: the adapter's way in. Everything is recorded on the exchange." },
  { key: "agent.facts", since: 5, doc: "Adds a fact source: facts about a run, asked at each begin." },
  { key: "agent.gate", since: 5, doc: "Adds a gate that may hold a node back from a run before it is asked." },
];
