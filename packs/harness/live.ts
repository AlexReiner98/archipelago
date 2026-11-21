/**
 * The harness view's live mode (`harness.live`): every live run at once,
 * each in a colour of its own. Its colours are the style's hues (`hue-1`…),
 * as tokens. A run keeps its colour while it stays live; a new one takes
 * the first colour free.
 *
 * - `liveRuns`: the runs that are live, last active first, as many as there
 *   are colours.
 * - `colours`: each live run's colour, kept from before where it can be.
 * - `keepLast`: an event added to the interleaved list, the last few kept.
 * - `Legend`: the live runs over the tree, each a click from being looked
 *   at alone; faint until it does something while watched (a run that
 *   stopped without ending stays live, but quiet).
 * - `LiveEvents`: the right pane: their events as they come, interleaved,
 *   each marked with its run's colour.
 */
import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import htm from "htm";
import type { RunInfo } from "../../spec/agent.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { HUES, sheet, v, type Token } from "../../spec/style.ts";
import { EventMark, short, what } from "./events.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** The runs that are live, last active first (as `exchange.read.runs` gives them), at most `max`. */
export function liveRuns(runs: RunInfo[], max: number = HUES.length): RunInfo[] {
  return runs.filter((r) => !r.ended).slice(0, max);
}

/** Each run's colour: the one it had, else the first not taken. */
export function colours(runs: string[], had: Map<string, Token> = new Map(), tokens: readonly Token[] = HUES): Map<string, Token> {
  const out = new Map<string, Token>();
  for (const r of runs) {
    const was = had.get(r);
    if (was) out.set(r, was);
  }
  for (const r of runs) {
    if (out.has(r)) continue;
    const taken = new Set(out.values());
    out.set(r, tokens.find((t) => !taken.has(t)) ?? tokens[out.size % tokens.length]!);
  }
  return out;
}

/** The list with `e` added at its end (once: an id already there is kept), the last `max` kept. */
export function keepLast(list: ExchangeEvent[], e: ExchangeEvent, max: number): ExchangeEvent[] {
  if (list.some((x) => x.id === e.id)) return list;
  const next = [...list, e];
  return next.length > max ? next.slice(next.length - max) : next;
}

export const LIVE_STYLE = sheet(`
.hv-legend { position:absolute; left:10px; top:10px; display:grid; gap:1px; padding:var(--space-2) var(--space-3); background:color-mix(in srgb, var(--bg) 88%, transparent); border:1px solid var(--line); border-radius:var(--radius); font-size:var(--text-s); max-width:260px; z-index:1; }
.hv-legend .r { display:flex; gap:var(--space-2); align-items:baseline; cursor:pointer; white-space:nowrap; min-width:0; }
.hv-legend .r:hover .x { color:var(--pick); }
.hv-legend .x { overflow:hidden; text-overflow:ellipsis; min-width:0; }
.hv-legend .d { flex:none; }
.hv-legend .none { color:var(--dim); }
.hv-legend .quiet .x { color:var(--dim); }
`);

const title = (r: RunInfo) => r.title ?? r.run.slice(0, 8);

export const Legend = ({ runs, colour, acting, onOpen }: { runs: RunInfo[]; colour: Map<string, Token>; acting: Set<string>; onOpen(run: string): void }) => html`
  <div class="hv-legend">
    ${!runs.length && html`<span class="none">No run is live</span>`}
    ${runs.map((r) => html`<div class=${`r ${acting.has(r.run) ? "" : "quiet"}`} title=${`${r.title ?? r.run}\n${acting.has(r.run) ? "" : "Nothing since live opened · "}Look at it alone`} onClick=${() => onOpen(r.run)}>
      <span class="d" style=${`color:${v(colour.get(r.run) ?? "fg")}`}>●</span><span class="x">${short(title(r), 40)}</span>
    </div>`)}
  </div>`;

export interface LiveEventsProps {
  runs: RunInfo[];
  events: ExchangeEvent[];
  colour: Map<string, Token>;
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
        ${!events.length && html`<div class="hv-empty" title=${runs.length ? "Their events show here as they come." : "A run is live from its start to its end."}>${runs.length ? "Nothing yet" : "No run is live"}</div>`}
        ${events.map((e) => {
          const r = byRun.get(e.run);
          const c = v(colour.get(e.run) ?? "dim");
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
