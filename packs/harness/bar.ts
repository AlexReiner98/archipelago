/**
 * The Sensory interface's bar, kept quiet: the run picker (every live run, every
 * run, or one), the live dot and the verdict tally in sight; the rest (the
 * profile looked at, how the tree hangs, nodes never said, the key, and the
 * view's dials) in one ⋯ menu.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { RunInfo } from "../../spec/agent.ts";
import { read as token, sheet, verdictGlyph } from "../../spec/style.ts";
import { short } from "./events.ts";
import type { Grouping } from "./layout.ts";
import { liveRuns } from "./live.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const BAR_STYLE = sheet(`
.hv-more { position:relative; flex:none; }
.hv-more .hv-menu { right:0; top:calc(100% + 6px); display:grid; gap:var(--space-2); padding:var(--space-3); min-width:300px; max-width:360px; white-space:nowrap; }
.hv-more .hv-menu .hv-dials { padding:var(--space-2) 0 0; margin-top:var(--space-1); border-top:1px solid var(--line); height:auto; }
.hv-more .hv-menu .hv-dial { padding:1px 0; }
.hv-more .row { display:flex; gap:var(--space-2); align-items:baseline; color:var(--dim); }
.hv-more .row .k { width:5em; flex:none; }
.hv-more button { font:inherit; background:none; border:0; color:var(--dim); padding:0; cursor:pointer; }
.hv-more button:hover { color:var(--fg); }
.hv-more button.on { color:var(--fg); text-decoration:underline; text-underline-offset:4px; }
`);

const clock = (t?: string) => (t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export interface BarProps {
  runs: RunInfo[];
  live: boolean;
  all: boolean;
  pinned?: string;
  info?: RunInfo;
  sum: { held: number; failed: number; quiet: number };
  profile?: string;
  profiles: { id: string; title: string; status: string }[];
  by: Grouping;
  hidden: number;
  unsaid: boolean;
  showKey: boolean;
  /** "live", "*" (every run), "" (the last active) or a run id. */
  onRun(value: string): void;
  onProfile(id: string | undefined): void;
  onBy(by: Grouping): void;
  onUnsaid(on: boolean): void;
  onKey(on: boolean): void;
  /** How many nodes the harness gave the agents shown; absent when nothing reads transcripts. */
  given?: number;
  showGiven?: boolean;
  onGiven?(on: boolean): void;
  /** More in the menu, under the rest: the view's dials. */
  more?: unknown;
}

export const Bar = (p: BarProps) => {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !more.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [open]);
  const value = p.live ? "live" : p.all ? "*" : (p.pinned ?? "");
  const groupings: Grouping[] = ["place", "channel", "pack", ...(p.profiles.length ? (["profile"] as Grouping[]) : [])];
  return html`
    <div class="hv-bar">
      <select class="hv-select" value=${value} title="Every live run at once, every run, or one run" onChange=${(e: Event) => p.onRun((e.target as HTMLSelectElement).value)}>
        <option value="live">live · ${liveRuns(p.runs).length} at once</option>
        <option value="*">all runs</option>
        <option value="">last active${p.runs[0] ? ` · ${short(p.runs[0].title ?? p.runs[0].run.slice(0, 8), 40)}` : ""}</option>
        ${p.runs.map((r) => html`<option value=${r.run}>${r.ended ? "○" : "●"} ${short(r.title ?? r.run.slice(0, 8), 40)} · ${clock(r.started)}</option>`)}
      </select>
      ${p.info && !p.info.ended && html`<span class="live" title="The run hasn't ended">●</span>`}
      ${!p.live && html`<span class="hv-n" title=${p.all ? "Every run's verdicts, node by run: held, failed, quiet" : "This run's verdicts: held, failed, quiet"}><span class="m-held">${token(verdictGlyph("held"))} ${p.sum.held}</span> <span class="m-failed">${token(verdictGlyph("failed"))} ${p.sum.failed}</span> <span class="m-quiet">${token(verdictGlyph("quiet"))} ${p.sum.quiet}</span></span>`}
      ${p.profile && html`<span class="hv-dim hv-cut" title="The profile looked at: what it holds back">in ${p.profiles.find((x) => x.id === p.profile)?.title ?? p.profile}</span>`}
      <span class="sp"></span>
      <span class="hv-more" ref=${more}>
        <button class=${open ? "on" : ""} title="Profile, grouping, key, dials" onClick=${() => setOpen(!open)}>⋯</button>
        ${open && html`<div class="hv-menu">
          <label class="row" title="A profile: what it holds back, over every run's totals"><span class="k">profile</span>
            <select class="hv-select" value=${p.profile ?? ""} onChange=${(e: Event) => p.onProfile((e.target as HTMLSelectElement).value || undefined)}>
              <option value="">${p.all ? "none" : "the run's"}</option>
              ${p.profiles.map((x) => html`<option value=${x.id}>${x.status === "on" ? "●" : x.status === "off" ? "○" : "◌"} ${x.title}</option>`)}
            </select>
          </label>
          <span class="row" title="How the tree hangs its nodes"><span class="k">hang by</span>${groupings.map((g, i) => html`${i > 0 && html`<span>·</span>`}<button class=${p.by === g ? "on" : ""} onClick=${() => p.onBy(g)}>${g}</button>`)}</span>
          ${p.by === "place" && html`<span class="row" title="Nodes with no place: kept, never said"><span class="k">show</span><button class=${p.unsaid ? "on" : ""} onClick=${() => p.onUnsaid(!p.unsaid)}>never said${p.hidden > 0 ? ` · ${p.hidden}` : ""}</button></span>`}
          ${p.given !== undefined && html`<span class="row" title="What the harness gave the agent (system prompt, tools, MCP instructions, listings, other hooks), read from its transcript: read only"><span class="k">given</span><button class=${p.showGiven ? "on" : ""} onClick=${() => p.onGiven?.(!p.showGiven)}>by the harness${p.showGiven && p.given > 0 ? ` · ${p.given}` : ""}</button></span>`}
          <span class="row"><span class="k">marks</span><button class=${p.showKey ? "on" : ""} onClick=${() => p.onKey(!p.showKey)} title="What the marks mean">key</button></span>
          ${p.more}
        </div>`}
      </span>
    </div>`;
};
