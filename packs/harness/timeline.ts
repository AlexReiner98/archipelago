/**
 * The Sensory interface's timeline: one tick per event of the run, in order,
 * coloured by what it was (replay.ts's `tickOf`), with the playhead on it.
 * A click or a drag on the strip moves the playhead; ⏮ goes to the start,
 * ▶ plays the run a step at a time, and "live" follows its end again.
 */
import { h } from "preact";
import { useRef } from "preact/hooks";
import htm from "htm";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { sheet } from "../../spec/style.ts";
import { STYLE } from "./layout.ts";
import { indexAt, tickOf } from "./replay.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);
const C = STYLE.colors;

export const TIMELINE_STYLE = sheet(`
.tl { display:flex; gap:var(--space-3); align-items:center; padding:var(--space-2) var(--space-4); border-top:1px solid var(--line); white-space:nowrap; min-width:0; }
.tl button { font:inherit; background:none; border:0; color:var(--dim); cursor:pointer; padding:0 var(--space-1); }
.tl button:hover, .tl button.on { color:var(--fg); }
.tl button.live.on { color:${C.say}; }
.tl-strip { flex:1; height:18px; min-width:0; cursor:pointer; position:relative; touch-action:none; }
.tl-strip svg { width:100%; height:100%; display:block; }
.tl-say { fill:${C.say}; } .tl-refuse, .tl-fail, .tl-miss { fill:${C.fail}; } .tl-act { fill:${C.write}; } .tl-gated { fill:var(--dim); } .tl-run { fill:var(--fg); }
.tl-later { opacity:.3; }
.tl-head { fill:var(--pick); }
.tl-n { color:var(--dim); font-variant-numeric:tabular-nums; min-width:5.5em; text-align:right; }
`);

export interface TimelineProps {
  events: ExchangeEvent[];
  index: number;
  /** No event pinned: it follows the run's end. */
  following: boolean;
  /** The run hasn't ended. */
  live: boolean;
  playing: boolean;
  onSeek(index: number): void;
  onPlay(): void;
  onLive(): void;
}

export const Timeline = ({ events, index, following, live, playing, onSeek, onPlay, onLive }: TimelineProps) => {
  const strip = useRef<HTMLDivElement>(null);
  const n = events.length;
  const seekAt = (clientX: number) => {
    const r = strip.current!.getBoundingClientRect();
    onSeek(indexAt((clientX - r.left) / Math.max(1, r.width), n));
  };
  const onDown = (e: PointerEvent) => {
    if (!n) return;
    const el = strip.current!;
    el.setPointerCapture(e.pointerId);
    seekAt(e.clientX);
    const move = (m: PointerEvent) => seekAt(m.clientX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const at = events[index];
  return html`
    <div class="tl">
      <button disabled=${!n} onClick=${() => onSeek(0)} title="To the start">⏮</button>
      <button disabled=${!n} class=${playing ? "on" : ""} onClick=${onPlay} title=${playing ? "Pause" : "Play the run a step at a time"}>${playing ? "⏸" : "▶"}</button>
      <div class="tl-strip" ref=${strip} onPointerDown=${onDown} title=${at ? `#${at.seq} ${at.kind}${at.place ? ` @${at.place}` : ""}` : "No events"}>
        <svg viewBox=${`0 0 ${Math.max(1, n)} 10`} preserveAspectRatio="none">
          ${events.map((e, i) => html`<rect key=${e.seq} class=${`tl-${tickOf(e)}${i > index ? " tl-later" : ""}`} x=${i + 0.1} y=${e.direction === "to_agent" ? 1 : 5} width="0.8" height="4" />`)}
          ${n > 0 && index >= 0 && html`<rect class="tl-head" x=${index} y="0" width=${Math.max(0.6, n / 400)} height="10" />`}
        </svg>
      </div>
      <span class="tl-n">${at ? `#${at.seq} / ${events[n - 1]!.seq}` : "—"}</span>
      <button class=${`live ${following ? "on" : ""}`} onClick=${onLive} title=${live ? "Follow the run as it goes" : "To its end"}>${live ? "● live" : "■ end"}</button>
    </div>
  `;
};
