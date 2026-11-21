/**
 * The Agents view's live mode (`harness.live`): every live run at once,
 * each in a colour of its own. Its colours are the style's hues (`hue-1`…),
 * as tokens. A run keeps its colour while it stays live; a new one takes
 * the first colour free.
 *
 * - `liveRuns`: the runs that are live, last active first, as many as there
 *   are colours.
 * - `colours`: each live run's colour, kept from before where it can be.
 * - `keepLast`: an event added to the interleaved list, the last few kept.
 * - The runs themselves are agents, each with a tree of its own (trees.ts).
 * - `LiveEvents`: the right pane: their events as they come, interleaved,
 *   each marked with its run's colour.
 */
import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import htm from "htm";
import type { RunInfo } from "../../spec/agent.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { HUES, v, type Token } from "../../spec/style.ts";
import { EventMark, short, what } from "./events.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** How many live runs the view shows at most: the page of runs it reads. */
export const LIVE_MOST = 50;

/** The runs that are live, last active first (as `exchange.read.runs` gives them), at most `max`. */
export function liveRuns(runs: RunInfo[], max: number = LIVE_MOST): RunInfo[] {
  return runs.filter((r) => !r.ended).slice(0, max);
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
 * A slot's colour, from the style's tokens only: the six hues, then round
 * again mixed toward the text colour (lighter by night), then toward the
 * page (darker), and so on.
 */
export function colourOf(slot: number, tokens: readonly Token[] = HUES): string {
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


const title = (r: RunInfo) => r.title ?? r.run.slice(0, 8);

export interface LiveEventsProps {
  runs: RunInfo[];
  events: ExchangeEvent[];
  /** Each run's colour, as CSS. */
  colour: Map<string, string>;
  titles: Map<string, string>;
  onPick(e: ExchangeEvent): void;
}

/** The live runs' events, newest at the foot, kept in sight. A click looks at that run alone, at that event. */
export const LiveEvents = ({ runs, events, colour, titles, onPick }: LiveEventsProps) => {
  const body = useRef<HTMLDivElement>(null);
  const byRun = new Map(runs.map((r) => [r.run, r]));
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [events.length]);
  return html`
    <div class="hv-pane">
      <div class="hv-head"><span class="t">Live</span><span class="hv-dim">${runs.length} runs</span></div>
      <div class="hv-body" ref=${body}>
        ${!events.length && html`<div class="hv-empty">${runs.length ? "Their events show here as they come." : "No run is live."}</div>`}
        ${events.map((e) => {
          const r = byRun.get(e.run);
          const c = colour.get(e.run) ?? v("dim");
          return html`<div class="hv-ev" style=${`box-shadow:inset 3px 0 0 ${c}`} onClick=${() => onPick(e)}>
            <div class="hv-line" title=${`${r ? title(r) : e.run} #${e.seq} ${e.kind}${e.place ? ` @${e.place}` : ""}\n${e.text ?? ""}`}>
              <span class="s" style=${`color:${c}`}>${e.seq}</span>
              <span class="hv-dir">${e.direction === "to_agent" ? "→" : "←"}</span>
              <${EventMark} e=${e} />
              ${e.place && html`<span class="p">${e.place}</span>`}
              <span class="x">${what(e, titles, r?.cwd)}</span>
            </div>
          </div>`;
        })}
      </div>
    </div>`;
};
