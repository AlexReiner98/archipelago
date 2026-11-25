/**
 * The Context interface's run pane (the right region): the run looked at, one line per event, in
 * one column. → the map to the agent, ← the agent to the map. The event at
 * the playhead is picked; those after it are faint until the run plays to
 * them. A click opens a line in place (expand.ts) and moves the playhead
 * there. Over the lines: the profiles the run is in, and its repo.
 */
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { Json } from "../../spec/common.ts";
import type { RunInfo } from "../../spec/agent.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import type { ProfileInfo } from "../../spec/profile.ts";
import { read, verdictGlyph } from "../../spec/style.ts";
import { expand, fold, type Part } from "./expand.ts";
import { gotAt } from "./got.ts";
import { SpendMark, type Spend } from "./spend.ts";
import type { Speaker } from "../claude-code/context.ts";
import type { RunVerdict, Verdict } from "./hooks.ts";
import { fillKey, type SlotRead } from "../../spec/slot.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const short = (val: unknown, n = 120): string => {
  const s = typeof val === "string" ? val : val === undefined ? "" : JSON.stringify(val);
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/** The first begin starts the run; a later one is the run saying more about itself. */
function beginLine(e: ExchangeEvent): string {
  const d = (e.detail ?? {}) as { started?: string; title?: string; task?: string };
  if (!d.started || d.started === e.time) return "run began";
  const told = [d.title && `"${short(d.title, 60)}"`, d.task && `on ${d.task}`].filter(Boolean).join(" ");
  return told ? `run is ${told}` : "run said what it is";
}

/** One line for what an act was about. */
export function actLine(e: ExchangeEvent, cwd?: string): string {
  const a = e.act;
  if (!a) return "";
  const i = (a.input ?? {}) as Record<string, Json>;
  // An act that says what it is (a typed call's attempt, its check): its own words.
  if (typeof i.description === "string" && a.kind !== "tool") return short(i.description);
  if (a.kind === "prompt") return short(typeof a.input === "string" ? a.input : (i.prompt ?? a.input));
  if (a.kind === "reply") return short(a.input ?? a.output);
  if (a.kind === "notice") return `waits on the person (${String(i.type ?? "notice")}): ${short(i.message ?? "")}`;
  if (a.kind === "decision") return `the person ${a.output === "deny" ? "denied" : "allowed"}: ${short(i.command ?? i.file_path ?? i.pattern ?? a.input)}`;
  const path = i.file_path ?? i.path ?? i.notebook_path;
  if (typeof path === "string") {
    const rel = cwd && path.toLowerCase().startsWith(cwd.toLowerCase()) ? path.slice(cwd.length).replace(/^[\\/]/, "") : path;
    return short(rel.replaceAll("\\", "/"));
  }
  return short(i.command ?? i.pattern ?? i.url ?? i.description ?? a.input);
}

const mark = (val: Verdict | "none") => read(verdictGlyph(val));
export const Mark = ({ v }: { v?: Verdict }) => html`<span class=${`hv-m m-${v ?? "none"}`} title=${v ?? "not said"}>${mark(v ?? "none")}</span>`;

/** An event's mark. */
export function EventMark({ e, v }: { e: ExchangeEvent; v?: Verdict }) {
  if (e.kind === "say") return html`<${Mark} v=${v} />`;
  if (e.kind === "refuse") return html`<span class="hv-m m-failed">⊘</span>`;
  if (e.kind === "act") return html`<span class=${`hv-m ${e.act?.ok === false ? "m-failed" : "m-act"}`}>${e.act?.ok === false ? "✕" : "●"}</span>`;
  if (e.kind === "begin") return html`<span class="hv-m m-quiet">▶</span>`;
  if (e.kind === "end") return html`<span class="hv-m m-quiet">■</span>`;
  if (e.kind === "compact") return html`<span class="hv-m m-quiet">⇣</span>`;
  if (e.kind === "gated") return html`<span class="hv-m m-quiet">${(e.detail as { trial?: boolean } | undefined)?.trial ? "◌" : "⊝"}</span>`;
  return html`<span class="hv-m m-failed">!</span>`;
}

/** One line for an event. */
export function what(e: ExchangeEvent, titles: Map<string, string>, cwd?: string): string {
  if (e.kind === "act") return actLine(e, cwd);
  if (e.node) {
    const d = e.detail as { resaid?: boolean; reworded?: boolean } | undefined;
    return `${d?.resaid ? "re-said · " : ""}${d?.reworded ? "reworded · " : ""}${titles.get(e.node) ?? e.node}: ${short(e.text)}`;
  }
  if (e.kind === "begin") return beginLine(e);
  if (e.kind === "end") return "run ended";
  if (e.kind === "compact") return `context compacted (${String((e.detail as { trigger?: string } | undefined)?.trigger ?? "auto")})`;
  return short(e.text);
}

/** One part of an opened row, its text folded past a dozen lines. */
export const PartRow = ({ p }: { p: Part }) => {
  const [all, setAll] = useState(false);
  const f = fold(p.text);
  return html`<div class="hv-part">
    <span class="k" title=${p.label}>${p.label}</span>
    <div><pre>${all ? p.text : f.head}</pre>${f.more > 0 && html`<button class="hv-fold" onClick=${() => setAll(!all)}>${all ? "fold" : `+${f.more} lines`}</button>`}</div>
  </div>`;
};

/** The slot on the run's line: other plugins' marks on the run shown, each given it as `run`. */
export const RUN_SLOT = "harness.run";

/** Draws `harness.run`'s fills with the run, redrawn when they change. */
export function runSlot(slots: SlotRead) {
  return ({ run }: { run: RunInfo }) => {
    const [, tick] = useState(0);
    useEffect(() => slots.watch(RUN_SLOT, () => tick((x) => x + 1)), []);
    return html`${slots.fills(RUN_SLOT).map((f) => h(f.view as any, { key: fillKey(f), run }))}`;
  };
}

export interface EventsProps {
  info?: RunInfo;
  events: ExchangeEvent[];
  /** How long a new line is lit as it lands, in ms (the row_ms dial). */
  rowMs?: number;
  /** The playhead. */
  index: number;
  /** The run is looked at to its end: it follows live. */
  end: boolean;
  verdicts: RunVerdict[];
  titles: Map<string, string>;
  /** The nodes loaded now, by id: what tags their words in what the agent got. */
  speakers?: Map<string, Speaker>;
  node?: string;
  profiles?: ProfileInfo[];
  /** Spend against the task's estimate (spend.ts). */
  spend?: Spend;
  /** Drawn at the end of the run's line under its head: the `harness.run` slot's fills. */
  extra?: unknown;
  onPick(e: ExchangeEvent): void;
}

/** Whether a list is scrolled to its foot, within `slack` px: new lines then keep it there. */
/** How long the list's own glide to its foot takes, at most: its scroll events then are not yours. */
const GLIDE_MS = 700;

/** A place as the run's list shows it: an MCP tool by its server and name (tool:archipelago.query), the rest as it is. */
export function placeLabel(place: string): string {
  const m = /^tool:mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(place);
  return m ? `tool:${m[1]}.${m[2]}` : place;
}

/** A line of the run's list: one event, or a run of held-back ones at one place, folded into one line. */
export type Fold = { ev: number } | { held: [number, number]; place: string };

/**
 * The run's list as lines: `least` or more held-back events in a row at one place (the nodes other context filters
 * keep from this run, `gated`) fold into one line, which a click opens; every other event is its own line. So a run
 * in a map of many filters reads from its start, not from under a page of what it didn't hear.
 */
export function foldHeld(events: readonly Pick<ExchangeEvent, "kind" | "place">[], least = 3): Fold[] {
  const out: Fold[] = [];
  for (let i = 0; i < events.length; ) {
    let j = i;
    while (j < events.length && events[j]!.kind === "gated" && events[j]!.place === events[i]!.place) j++;
    if (events[i]!.kind === "gated" && j - i >= least) {
      out.push({ held: [i, j - 1], place: events[i]!.place ?? "" });
      i = j;
    } else out.push({ ev: i++ });
  }
  return out;
}

export function atFoot(scrollHeight: number, scrollTop: number, clientHeight: number, slack = 24): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}

export const Events = ({ info, events, index, end, verdicts, titles, speakers, node, profiles, spend, extra, onPick, rowMs }: EventsProps) => {
  const body = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const stick = useRef(true);
  /** When the list last glided to its foot itself: its own scrolling then says nothing about where you are reading. */
  const glidedAt = useRef(0);
  // Another run: nothing open, and it starts at its foot.
  useEffect(() => {
    setOpened(new Set());
    stick.current = true;
  }, [info?.run]);
  const verdictOf = useMemo(() => new Map(verdicts.map((x) => [x.node, x])), [verdicts]);
  const broke = useMemo(() => new Set(node ? (verdictOf.get(node)?.failed_by ?? []) : []), [node, verdictOf]);
  const at = events[index];
  // New events keep the list at its foot only while you are at its foot: scrolled up to read, it stays put.
  useEffect(() => {
    const el = body.current;
    // Glided there, so a new line never jumps the list a whole row in one frame.
    if (el && end && stick.current) {
      glidedAt.current = performance.now();
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [end, events.length]);
  // The playhead moved (a pick, a step): its line comes into sight.
  useEffect(() => {
    const el = body.current;
    if (el && !end && at) el.querySelector(`[data-ev="${CSS.escape(at.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at?.id]);
  const toggle = (key: string) =>
    setOpened((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const row = (e: ExchangeEvent, i: number) => {
    const isOpen = opened.has(e.id);
    const cls = ["hv-ev", i === index && !end ? "hv-pick hv-lit" : "", node && e.node === node ? "hv-lit" : "", i > index ? "hv-later" : "", broke.has(e.seq) ? "broke" : ""].join(" ");
    return html`
      <div key=${e.id} data-ev=${e.id} class=${cls} onClick=${() => (toggle(e.id), onPick(e))}>
        <div class="hv-line" title=${`#${e.seq} ${e.kind}${e.place ? ` @${e.place}` : ""}${e.node ? ` ${e.node}` : ""}\n${e.text ?? actLine(e)}`}>
          <span class="s">${e.seq}</span>
          <span class="hv-dir">${e.direction === "to_agent" ? "→" : "←"}</span>
          <${EventMark} e=${e} v=${e.node ? verdictOf.get(e.node)?.verdict : undefined} />
          ${e.place && html`<span class="p" title=${e.place}>${placeLabel(e.place)}</span>`}
          <span class="x">${what(e, titles, info?.cwd)}</span>
        </div>
        ${isOpen && html`<div class="hv-open" onClick=${(ev: Event) => ev.stopPropagation()}>${expand(e, info?.harness === "claude-code" && speakers ? gotAt(events, i, speakers) : undefined).map((p, k) => html`<${PartRow} key=${k} p=${p} />`)}</div>`}
      </div>
    `;
  };
  // The transcript fact is a path on this machine: never shown.
  const facts = Object.fromEntries(Object.entries(info?.facts ?? {}).filter(([k]) => k !== "transcript"));
  return html`
    <div class="hv-pane">
      <div class="hv-head" title=${Object.entries(facts).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(", ") : x}`).join("\n")}>
        <span class="t">Run</span>
        <span class="hv-dim">${events.length}</span>
        <span class="sp"></span>
        <${SpendMark} s=${spend} />
        ${facts.remote && html`<span class="hv-dim hv-cut">${String(facts.remote).split("/").slice(-1)[0]}${facts.branch ? ` · ${facts.branch}` : ""}</span>`}
      </div>
      ${info && html`<div class="hv-prof">
        ${profiles && !profiles.length && html`<span class="part" title="In no context filter: it hears every node">no context filter</span>`}
        ${(profiles ?? []).map((p) => html`<span class=${p.by === "part" ? "part" : ""} title=${`${p.holding ? "holds" : "shadow: only records"}${p.by === "part" ? ", as a part" : ""}`}>${p.holding ? "●" : "◌"} ${p.title}</span>`)}
        ${extra}
      </div>`}
      <div class="hv-body" style=${`--hv-row:${rowMs ?? 600}ms`} ref=${body} onScroll=${(ev: Event) => {
        const el = ev.currentTarget as HTMLElement;
        if (performance.now() - glidedAt.current < GLIDE_MS) return;
        stick.current = atFoot(el.scrollHeight, el.scrollTop, el.clientHeight);
      }}>
        ${!info && html`<div class="hv-empty" title="A run shows here as its agent works: what the map said, and what it did.">No run yet</div>`}
        ${foldHeld(events).map((f) => {
          if ("ev" in f) return row(events[f.ev]!, f.ev);
          const [from, to] = f.held, key = `held:${events[from]!.id}`, isOpen = opened.has(key);
          const here = index >= from && index <= to && !end;
          return html`
            <div key=${key} class=${`hv-ev hv-held${here && !isOpen ? " hv-pick hv-lit" : ""}`} onClick=${() => toggle(key)}>
              <div class="hv-line" title=${`#${events[from]!.seq}–${events[to]!.seq}: nodes this run's context filters keep from it (another filter's, or no filter's under a strict one)${f.place ? ` @${f.place}` : ""}`}>
                <span class="s">${events[from]!.seq}</span>
                <span class="hv-dir">→</span>
                <span class="hv-m m-quiet">⊝</span>
                ${f.place && html`<span class="p" title=${f.place}>${placeLabel(f.place)}</span>`}
                <span class="x">${to - from + 1} held back from this run ${isOpen ? "▾" : "▸"}</span>
              </div>
            </div>
            ${isOpen && events.slice(from, to + 1).map((e, k) => row(e, from + k))}
          `;
        })}
      </div>
    </div>
  `;
};
