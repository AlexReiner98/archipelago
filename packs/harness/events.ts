/**
 * The harness view's left pane: the run looked at, one line per event, in
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
import type { RunVerdict, Verdict } from "./hooks.ts";

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
function EventMark({ e, v }: { e: ExchangeEvent; v?: Verdict }) {
  if (e.kind === "say") return html`<${Mark} v=${v} />`;
  if (e.kind === "refuse") return html`<span class="hv-m m-failed">⊘</span>`;
  if (e.kind === "act") return html`<span class=${`hv-m ${e.act?.ok === false ? "m-failed" : "m-act"}`}>${e.act?.ok === false ? "✕" : "●"}</span>`;
  if (e.kind === "begin") return html`<span class="hv-m m-quiet">▶</span>`;
  if (e.kind === "end") return html`<span class="hv-m m-quiet">■</span>`;
  if (e.kind === "compact") return html`<span class="hv-m m-quiet">⇣</span>`;
  if (e.kind === "gated") return html`<span class="hv-m m-quiet">${(e.detail as { trial?: boolean } | undefined)?.trial ? "◌" : "⊝"}</span>`;
  return html`<span class="hv-m m-failed">!</span>`;
}

function what(e: ExchangeEvent, titles: Map<string, string>, cwd?: string): string {
  if (e.kind === "act") return actLine(e, cwd);
  if (e.node) return `${(e.detail as { resaid?: boolean } | undefined)?.resaid ? "re-said · " : ""}${titles.get(e.node) ?? e.node}: ${short(e.text)}`;
  if (e.kind === "begin") return beginLine(e);
  if (e.kind === "end") return "run ended";
  if (e.kind === "compact") return `context compacted (${String((e.detail as { trigger?: string } | undefined)?.trigger ?? "auto")})`;
  return short(e.text);
}

/** One part of an opened row, its text folded past a dozen lines. */
const PartRow = ({ p }: { p: Part }) => {
  const [all, setAll] = useState(false);
  const f = fold(p.text);
  return html`<div class="hv-part">
    <span class="k" title=${p.label}>${p.label}</span>
    <div><pre>${all ? p.text : f.head}</pre>${f.more > 0 && html`<button class="hv-fold" onClick=${() => setAll(!all)}>${all ? "fold" : `+${f.more} lines`}</button>`}</div>
  </div>`;
};

export interface EventsProps {
  info?: RunInfo;
  events: ExchangeEvent[];
  /** The playhead. */
  index: number;
  /** The run is looked at to its end: it follows live. */
  end: boolean;
  verdicts: RunVerdict[];
  titles: Map<string, string>;
  node?: string;
  profiles?: ProfileInfo[];
  onPick(e: ExchangeEvent): void;
}

export const Events = ({ info, events, index, end, verdicts, titles, node, profiles, onPick }: EventsProps) => {
  const body = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  useEffect(() => setOpened(new Set()), [info?.run]);
  const verdictOf = useMemo(() => new Map(verdicts.map((x) => [x.node, x])), [verdicts]);
  const broke = useMemo(() => new Set(node ? (verdictOf.get(node)?.failed_by ?? []) : []), [node, verdictOf]);
  const at = events[index];
  // Keep the playhead in sight: at the end while following, else on its line.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    if (end) el.scrollTop = el.scrollHeight;
    else if (at) el.querySelector(`[data-ev="${CSS.escape(at.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at?.id, end, events.length]);
  const facts = info?.facts ?? {};
  return html`
    <div class="hv-pane">
      <div class="hv-head" title=${Object.entries(facts).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(", ") : x}`).join("\n")}>
        <span class="t">Run</span>
        <span class="hv-dim">${events.length}</span>
        <span class="sp"></span>
        ${facts.remote && html`<span class="hv-dim hv-cut">${String(facts.remote).split("/").slice(-1)[0]}${facts.branch ? ` · ${facts.branch}` : ""}</span>`}
      </div>
      ${info && html`<div class="hv-prof">
        ${profiles && !profiles.length && html`<span class="part" title="In no profile: it hears every node">no profile</span>`}
        ${(profiles ?? []).map((p) => html`<span class=${p.by === "part" ? "part" : ""} title=${`${p.holding ? "holds" : "shadow: only records"}${p.by === "part" ? ", as a part" : ""}`}>${p.holding ? "●" : "◌"} ${p.title}</span>`)}
      </div>`}
      <div class="hv-body" ref=${body}>
        ${!info && html`<div class="hv-empty">No run yet.</div>`}
        ${events.map((e, i) => {
          const isOpen = opened.has(e.id);
          const cls = ["hv-ev", i === index && !end ? "hv-pick hv-lit" : "", node && e.node === node ? "hv-lit" : "", i > index ? "hv-later" : "", broke.has(e.seq) ? "broke" : ""].join(" ");
          return html`
            <div data-ev=${e.id} class=${cls} onClick=${() => {
              setOpened((o) => {
                const n = new Set(o);
                if (n.has(e.id)) n.delete(e.id);
                else n.add(e.id);
                return n;
              });
              onPick(e);
            }}>
              <div class="hv-line" title=${`#${e.seq} ${e.kind}${e.place ? ` @${e.place}` : ""}${e.node ? ` ${e.node}` : ""}\n${e.text ?? actLine(e)}`}>
                <span class="s">${e.seq}</span>
                <span class="hv-dir">${e.direction === "to_agent" ? "→" : "←"}</span>
                <${EventMark} e=${e} v=${e.node ? verdictOf.get(e.node)?.verdict : undefined} />
                ${e.place && html`<span class="p">${e.place}</span>`}
                <span class="x">${what(e, titles, info?.cwd)}</span>
              </div>
              ${isOpen && html`<div class="hv-open" onClick=${(ev: Event) => ev.stopPropagation()}>${expand(e).map((p, k) => html`<${PartRow} key=${k} p=${p} />`)}</div>`}
            </div>
          `;
        })}
      </div>
    </div>
  `;
};
