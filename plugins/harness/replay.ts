/**
 * A run played up to a point, as pure functions: no page, no capabilities.
 *
 * - `playhead`: where the run is looked at, the event `here.event` names,
 *   else its last (following it live).
 * - `stateAt`: what the run had heard, refused and held back by then, and
 *   how often it said each node, node by node; and whether that is its end.
 * - `tickOf`: an event's mark on the timeline.
 * - `nodeOf`: the node an event involves, for the node pane to follow.
 * - `holdsOf`: a profile's answer (`profile.read.hears`) as holds, for a
 *   profile looked at without a run.
 */
import type { Hearing } from "../../spec/profile.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";

/** What a run did with a node: said it to the agent, or stopped the agent with it. */
export type Heard = "said" | "refused";
/** Why a node wasn't said: a profile held it back, or a shadow would have (it was still said). */
export type Hold = "held" | "shadow";

export interface Replay {
  /** The event looked at, by its place in the list; -1 when there is none. */
  index: number;
  at?: ExchangeEvent;
  /** Each node the run reached by then: a refusal wins over a say. */
  heard: Map<string, Heard>;
  /** Each node a gate held back by then. */
  held: Map<string, Hold>;
  /** How often the run said each node by then. */
  counts: Map<string, number>;
  /** At the run's last event: what follows is live, and the verdicts are the run's. */
  end: boolean;
}

/** The event looked at: the one named, else the last. -1 when the run has none. */
export function playhead(events: ExchangeEvent[], event?: string): number {
  if (event) {
    const i = events.findIndex((e) => e.id === event);
    if (i >= 0) return i;
  }
  return events.length - 1;
}

/** The run up to and with the event at `index`. */
export function stateAt(events: ExchangeEvent[], index: number): Replay {
  const heard = new Map<string, Heard>();
  const held = new Map<string, Hold>();
  const counts = new Map<string, number>();
  const upto = Math.min(index, events.length - 1);
  for (let i = 0; i <= upto; i++) {
    const e = events[i]!;
    if (!e.node) continue;
    if (e.kind === "say") counts.set(e.node, (counts.get(e.node) ?? 0) + 1);
    if (e.kind === "refuse") heard.set(e.node, "refused");
    else if (e.kind === "say" && !heard.has(e.node)) heard.set(e.node, "said");
    else if (e.kind === "gated") held.set(e.node, (e.detail as { trial?: boolean } | undefined)?.trial ? "shadow" : "held");
  }
  return { index: upto, ...(upto >= 0 ? { at: events[upto] } : {}), heard, held, counts, end: upto === events.length - 1 };
}

/** The timeline's mark for an event. */
export type Tick = "say" | "refuse" | "act" | "fail" | "gated" | "run" | "miss";

export function tickOf(e: ExchangeEvent): Tick {
  if (e.kind === "say") return "say";
  if (e.kind === "refuse") return "refuse";
  if (e.kind === "act") return e.act?.ok === false ? "fail" : "act";
  if (e.kind === "gated") return "gated";
  if (e.kind === "miss") return "miss";
  return "run";
}

/** A profile's answers as holds: held back now, or only by a shadow. Nodes it lets through are left out. */
export function holdsOf(hearing: Map<string, Hearing>): Map<string, Hold> {
  const out = new Map<string, Hold>();
  for (const [node, h] of hearing) {
    if (!h.hears) out.set(node, "held");
    else if (h.shadow) out.set(node, "shadow");
  }
  return out;
}

/** The index a click lands on: a fraction of the strip's width, as one of `n` equal ticks. */
export function indexAt(fraction: number, n: number): number {
  if (n <= 0) return -1;
  return Math.max(0, Math.min(n - 1, Math.floor(fraction * n)));
}

/**
 * The node an event involves: its own; for an act, a node it failed (by the
 * run's verdicts), else the nearest node said or refused in the moment just
 * before it (the map's lines right above it). Nothing when none did.
 */
export function nodeOf(events: ExchangeEvent[], index: number, failedBy: { node: string; failed_by: number[] }[] = []): string | undefined {
  const e = events[index];
  if (!e) return undefined;
  if (e.node) return e.node;
  if (e.kind !== "act") return undefined;
  const failed = failedBy.find((v) => v.failed_by.includes(e.seq));
  if (failed) return failed.node;
  for (let i = index - 1; i >= 0 && events[i]!.direction === "to_agent"; i--) {
    const before = events[i]!;
    if ((before.kind === "say" || before.kind === "refuse") && before.node) return before.node;
  }
  return undefined;
}
