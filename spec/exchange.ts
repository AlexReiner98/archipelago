/**
 * exchange 0.1.0: one event per say, refusal and act. See exchange.md.
 */
import type { Act, Place, RunId, RunInfo } from "./agent.ts";
import type { ContractVersion, Dispose, Json, Page, PageRequest, PackId, Time } from "./common.ts";

export const contract: ContractVersion<"exchange"> = { name: "exchange", version: "0.1.0" };

/** `to_agent`: the map spoke. `from_agent`: the agent (or the person at its prompt) did. */
export type ExchangeDirection = "to_agent" | "from_agent";

/**
 * - `begin`, `end`: the run's edges.
 * - `say`, `refuse`: a node spoke at a place (to_agent).
 * - `act`: the agent did something (from_agent).
 * - `miss`: something in the exchange itself went wrong: a node threw, or
 *   refused where refusing can't stop anything. Not the agent's fault.
 */
export type ExchangeKind = "begin" | "end" | "say" | "refuse" | "act" | "miss";

export interface ExchangeEvent {
  id: string;
  run: RunId;
  /** Per run, from 1, no gaps: the order things happened in. */
  seq: number;
  time: Time;
  place: Place;
  direction: ExchangeDirection;
  kind: ExchangeKind;
  /** The node that spoke (say, refuse, miss). */
  node?: string;
  /** The pack the node or the act's action belongs to. */
  pack?: PackId;
  /** What was said, or a refusal's words, or a miss's error. */
  text?: string;
  /** For `act`: what the agent did. */
  act?: Omit<Act, "run" | "place" | "time">;
  detail?: Json;
}

export interface ExchangeFilter {
  run?: RunId;
  node?: string;
  pack?: PackId;
  kinds?: ExchangeKind[];
}

/** The service, provided as `exchange@0`. */
export interface Exchange {
  /**
   * Records an event and gives it its id and seq. The agent service calls
   * this for everything that passes through it; nothing else should.
   */
  append(event: Omit<ExchangeEvent, "id" | "seq">): Promise<ExchangeEvent>;
  /** Runs, newest first. */
  runs(page?: PageRequest): Promise<Page<RunInfo>>;
  /** One run's events in seq order. */
  events(run: RunId, page?: PageRequest): Promise<Page<ExchangeEvent>>;
  /** A node's events across runs, newest first: what the node page shows. */
  said(node: string, page?: PageRequest): Promise<Page<ExchangeEvent>>;
  /** Live: each event as it is appended. */
  watch(filter: ExchangeFilter, on: (event: ExchangeEvent) => void): Dispose;
}
