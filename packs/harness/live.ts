/**
 * The Context interface's live mode (`harness.live`): every live run at once,
 * each in a colour of its own. Its colours are the style's hues (`hue-1`…),
 * as tokens. A run keeps its colour while it stays live; a new one takes
 * the first colour free.
 *
 * - `liveRuns`: the runs that are live, last active first, the last 50.
 * - `colourOf`: a colour slot's colour, from the style's hues and past them.
 * - `colours`: each live run's colour, kept from before where it can be.
 * - `keepLast`: an event added to the live events, the last few kept.
 * - The runs themselves are agents, each with a tree of its own (trees.ts).
 */
import { runName, type RunInfo } from "../../spec/agent.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { HUES, v, type Token } from "../../spec/style.ts";

/** How many live runs the view shows at most: the page of runs it reads. */
export const LIVE_MOST = 50;

/** Minutes a run may be quiet and still be live, unless the dial says (`quiet_min`): as Activity counts a run live. */
export const QUIET_MIN = 15;

/** Whether a run is live: not ended, and heard from within `quietMin` minutes. A run whose harness stopped without ending it (a session archived or killed) drops out. */
export function isLive(r: RunInfo, quietMin: number = QUIET_MIN, now: number = Date.now()): boolean {
  if (r.ended) return false;
  const at = Date.parse(r.last ?? r.started);
  return !Number.isFinite(at) || now - at <= quietMin * 60_000;
}

/** The runs that are live, last active first (as `exchange.read.runs` gives them), at most `max`. */
export function liveRuns(runs: RunInfo[], max: number = LIVE_MOST, quietMin: number = QUIET_MIN, now: number = Date.now()): RunInfo[] {
  return runs.filter((r) => isLive(r, quietMin, now)).slice(0, max);
}

/** Each run's colour slot: the one it had, else the lowest not taken. As many as there are runs. */
export function colours(runs: string[], had: Map<string, number> = new Map()): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of runs) {
    const was = had.get(r);
    if (was !== undefined) out.set(r, was);
  }
  for (const r of runs) {
    if (out.has(r)) continue;
    const taken = new Set(out.values());
    let i = 0;
    while (taken.has(i)) i++;
    out.set(r, i);
  }
  return out;
}

/**
 * The hues an agent takes: the style's, less the warm `hue-2` and `hue-4`, too near the orange
 * that marks what Claude Code gave (as the packs' hues leave it out, layout.ts),
 * so an agent's lights and sparks never read as Claude Code's.
 */
export const AGENT_HUES: readonly Token[] = HUES.filter((t) => t !== "hue-2" && t !== "hue-4");

/**
 * A slot's colour, from the style's tokens only: the agent hues, then round
 * again mixed toward the text colour (lighter by night), then toward the
 * page (darker), and so on.
 */
export function colourOf(slot: number, tokens: readonly Token[] = AGENT_HUES): string {
  const hue = v(tokens[slot % tokens.length]!);
  const round = Math.floor(slot / tokens.length);
  if (!round) return hue;
  const toward = round % 2 ? v("fg") : v("bg");
  const share = Math.max(30, 65 - 10 * Math.floor((round - 1) / 2));
  return `color-mix(in srgb, ${hue} ${share}%, ${toward})`;
}

/** The list with `e` added at its end (once: an id already there is kept), the last `max` kept. */
export function keepLast(list: ExchangeEvent[], e: ExchangeEvent, max: number): ExchangeEvent[] {
  if (list.some((x) => x.id === e.id)) return list;
  const next = [...list, e];
  return next.length > max ? next.slice(next.length - max) : next;
}


const title = (r: RunInfo) => runName(r);
