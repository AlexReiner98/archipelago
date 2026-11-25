/**
 * exchange: one event per say, refusal and act. See exchange.md.
 */
import type { Act, Place, RunId, RunInfo } from "./agent.ts";
import type { Capability, Dispose, Json, Page, PageRequest, PluginId, Term, Time } from "./common.ts";

/** `to_agent`: the map spoke. `from_agent`: the agent (or the person at its prompt) did. */
export type ExchangeDirection = "to_agent" | "from_agent";

/** Open vocabulary: a consumer skips events of a kind it doesn't know. */
export const EVENT_KINDS: Term[] = [
  { term: "begin", since: 1, doc: "The run started." },
  { term: "end", since: 1, doc: "The run ended." },
  { term: "say", since: 1, doc: "A node gave words at a place (to_agent)." },
  { term: "refuse", since: 1, doc: "A node stopped what was happening at a place (to_agent)." },
  { term: "act", since: 1, doc: "The agent, or the person at its prompt, did something (from_agent)." },
  { term: "miss", since: 1, doc: "The exchange itself went wrong: a node threw, or refused where it couldn't." },
  { term: "compact", since: 3, doc: "The run's context is being compacted (from_agent, at `compact`, detail the moment's input): a node said again after it is re-said (its say's `detail.resaid`)." },
  { term: "gated", since: 5, doc: "A gate held a node back from the run (to_agent, at the place it listened at, `node` the node, text why, detail `{gate}`), once per run and node: it wasn't quiet, it wasn't asked. With `detail.trial` the hold was only recorded, and the node was asked." },
];

export interface ExchangeEvent {
  id: string;
  run: RunId;
  /** Per run, from 1, no gaps: the order things happened in. */
  seq: number;
  time: Time;
  /** Where in the run. Absent for `begin`, `end`, and a miss about the run itself. */
  place?: Place;
  direction: ExchangeDirection;
  kind: string;
  /** The node that spoke (say, refuse, miss). */
  node?: string;
  /** The plugin the node or the act's action belongs to. */
  plugin?: PluginId;
  /** What was said, or a refusal's words, or a miss's error. */
  text?: string;
  /** For `act`: what the agent did. */
  act?: Omit<Act, "run" | "place" | "time">;
  detail?: Json;
}

export interface ExchangeFilter {
  run?: RunId;
  node?: string;
  plugin?: PluginId;
  kinds?: string[];
}

/** `exchange.append`: only the provider of `agent.run` should be given it. */
export interface ExchangeAppend {
  /** Records an event and gives it its id and seq. */
  append(event: Omit<ExchangeEvent, "id" | "seq">): Promise<ExchangeEvent>;
}

/** `exchange.read`. */
export interface ExchangeRead {
  /** Runs, newest first. */
  runs(page?: PageRequest): Promise<Page<RunInfo>>;
  /** One run's events in seq order. */
  events(run: RunId, page?: PageRequest): Promise<Page<ExchangeEvent>>;
  /** A node's events across runs, newest first: what the node page shows. */
  said(node: string, page?: PageRequest): Promise<Page<ExchangeEvent>>;
}

/** `exchange.watch`. */
export interface ExchangeWatch {
  /** Live: each event as it is appended. */
  watch(filter: ExchangeFilter, on: (event: ExchangeEvent) => void): Dispose;
}

export interface Capabilities {
  "exchange.append": ExchangeAppend;
  "exchange.read": ExchangeRead;
  "exchange.watch": ExchangeWatch;
}

export const capabilities: Capability[] = [
  { key: "exchange.append", since: 1, doc: "Records an exchange event, numbering it within its run." },
  { key: "exchange.read", since: 1, doc: "Runs, a run's events, a node's events: bounded pages." },
  { key: "exchange.watch", since: 1, doc: "Each event as it is appended, by run, node, plugin or kind." },
];
