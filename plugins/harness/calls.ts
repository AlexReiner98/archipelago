/**
 * Calls: one request to a model made by a plugin (the call plugin's runs,
 * `harness: "call"`), under the run that made them. They aren't agents:
 * they never get a tree of their own among the live ones, nor a line in
 * the run picker. Under their parent they collapse into one strip, their
 * count and a ✓ ✕ ○ tally (each call by its verdicts: failed when a node
 * said to it failed, held when one held, else quiet); opened, a line each,
 * newest first; a click looks at that call alone, a one-request tree.
 *
 * - `isCall`, `parentOf`, `callsOf`: which runs are calls, and whose.
 * - `outcomeOf`, `tallyOf`: a call's mark from its verdicts, and the strip's tally.
 * - `CallStrip`: the strip.
 */
import { h } from "preact";
import htm from "htm";
import { runName, type RunInfo } from "../../spec/agent.ts";
import { sheet } from "../../spec/style.ts";
import { time } from "./clock.ts";

/** A node's verdict in a run, as verdict.read gives it. */
type Verdict = "held" | "failed" | "quiet";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** A call's `harness` fact. */
export const CALL = "call";
/** How many calls the strip lists when open: the newest. */
export const CALLS_SHOWN = 100;

export const isCall = (r: RunInfo): boolean => (r.facts?.harness ?? r.harness) === CALL;
export const parentOf = (r: RunInfo): string | undefined => {
  const p = r.facts?.parent ?? r.parent;
  return typeof p === "string" ? p : undefined;
};

/** The calls a run made, newest first, from the runs read. */
export function callsOf(runs: RunInfo[], parent: string | undefined): RunInfo[] {
  if (!parent) return [];
  return runs.filter((r) => isCall(r) && parentOf(r) === parent).sort((a, b) => (a.started < b.started ? 1 : a.started > b.started ? -1 : 0));
}

/** Whether a node's `at` pattern matches a reached place, as spec/agent.md says: the same family, `*` within a segment, `**` across. */
export function placeMatches(pattern: string, place: string): boolean {
  if (pattern === place) return true;
  const fam = (p: string) => (p.includes(":") ? p.slice(0, p.indexOf(":") + 1) : p);
  const f = fam(pattern);
  if (f !== fam(place) || !f.endsWith(":")) return false;
  const re = pattern
    .slice(f.length)
    .split("**")
    .map((part) => part.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${re}$`).test(place.slice(f.length));
}

/** A call's one-request tree: only the nodes listening where it reached (said to it, or held back from it). */
export function requestNodes<N extends { at: string[] }>(nodes: N[], call: RunInfo): N[] {
  const places = call.reaches.filter((p) => p !== "reply_end");
  return nodes.filter((n) => n.at.some((a) => places.some((p) => placeMatches(a, p))));
}

export type Outcome = Verdict | "none";

/** A call's mark: failed when a node said to it failed, held when one held, quiet when nodes were said and nothing judged them, none when nothing was said. */
export function outcomeOf(verdicts: { verdict: Verdict }[]): Outcome {
  if (!verdicts.length) return "none";
  if (verdicts.some((v) => v.verdict === "failed")) return "failed";
  if (verdicts.some((v) => v.verdict === "held")) return "held";
  return "quiet";
}

/** The strip's tally: how many calls held, failed, and are quiet (or had nothing said). */
export function tallyOf(outcomes: Outcome[]): { held: number; failed: number; quiet: number } {
  const t = { held: 0, failed: 0, quiet: 0 };
  for (const o of outcomes) o === "held" ? t.held++ : o === "failed" ? t.failed++ : t.quiet++;
  return t;
}

const MARK: Record<Outcome, string> = { held: "✓", failed: "✕", quiet: "○", none: "·" };
const TIP: Record<Outcome, string> = {
  held: "Held: its answer was accepted, so the nodes said to it held",
  failed: "Failed: its answer was rejected, so the nodes said to it failed",
  quiet: "Quiet: not decided yet",
  none: "Nothing on the map was said to it",
};

export const CALLS_STYLE = sheet(`
.hv-calls { border-bottom:1px solid var(--line); min-width:0; }
.hv-calls .s { display:flex; gap:var(--space-3); align-items:baseline; padding:var(--space-1) var(--space-4); white-space:nowrap; min-width:0; }
.hv-calls .s button { font:inherit; background:none; border:0; padding:0; color:var(--dim); cursor:pointer; flex:none; }
.hv-calls .s button:hover { color:var(--fg); }
.hv-calls .s .n { font-variant-numeric:tabular-nums; }
.hv-calls .list { max-height:9.5em; overflow:auto; padding-bottom:var(--space-1); }
.hv-calls .c { display:flex; gap:var(--space-3); align-items:baseline; padding:0 var(--space-4) 0 var(--space-5); white-space:nowrap; cursor:pointer; }
.hv-calls .c:hover { background:color-mix(in srgb, var(--line) 50%, transparent); }
.hv-calls .c.on { box-shadow:inset 3px 0 0 var(--pick); }
.hv-calls .c .x { overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
.hv-calls .c .t { color:var(--dim); font-variant-numeric:tabular-nums; flex:none; }
`);

export interface StripCall {
  run: RunInfo;
  outcome: Outcome;
  /** How many nodes were said to it. */
  said: number;
}

/**
 * The calls under a run: one line, opened by a click into a line per call.
 * Looking at a call, the strip is its parent's, that call marked, with a way back.
 */
export const CallStrip = ({ parent, calls, open, at, onOpen, onPick, onBack }: { parent?: RunInfo; calls: StripCall[]; open: boolean; at?: string; onOpen(open: boolean): void; onPick(run: string): void; onBack?(): void }) => {
  if (!calls.length) return html`<span></span>`;
  const t = tallyOf(calls.map((c) => c.outcome));
  const who = parent ? runName(parent) : "its run";
  return html`<div class="hv-calls">
    <div class="s">
      ${onBack && html`<button title=${`Back to ${who}`} onClick=${onBack}>‹ ${who}</button>`}
      <button title=${open ? "Fold the calls to one line" : "Open the calls: a line each, a click looks at one"} onClick=${() => onOpen(!open)}>calls ${open ? "▾" : "▸"}</button>
      <span class="n" title=${`${calls.length} calls ${who} made: each one request to a model, a run of its own`}>${calls.length}</span>
      <span class="n m-held" title=${TIP.held}>✓ ${t.held}</span>
      <span class="n m-failed" title=${TIP.failed}>✕ ${t.failed}</span>
      <span class="n m-quiet" title=${TIP.quiet}>○ ${t.quiet}</span>
    </div>
    ${open && html`<div class="list" role="list">
      ${calls.slice(0, CALLS_SHOWN).map((c) => html`<div key=${c.run.run} role="listitem" class=${`c${at === c.run.run ? " on" : ""}`} title=${`${runName(c.run)}\n${TIP[c.outcome]}\n${c.said} node${c.said === 1 ? "" : "s"} said to it`} onClick=${() => onPick(c.run.run)}>
        <span class=${`hv-m m-${c.outcome}`}>${MARK[c.outcome]}</span><span class="x">${runName(c.run)}</span><span class="t">${c.said} said · ${time(c.run.started)}</span>
      </div>`)}
      ${calls.length > CALLS_SHOWN && html`<div class="c hv-dim">and ${calls.length - CALLS_SHOWN} older</div>`}
    </div>`}
  </div>`;
};
