/**
 * The Context interface's right fill ("Run"): the events of the run looked
 * at, or live the agent in focus's, one line each (events.ts); looking at
 * every run, the runs, or a profile's, with their spend against estimate.
 */
import { h } from "preact";
import { useMemo } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import { runName, type RunInfo } from "../../spec/agent.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import { Events } from "./events.ts";
import { FOCUS, PROFILE, type hooks } from "./hooks.ts";
import { useDials } from "./dials.ts";
import { nodeOf, playhead } from "./replay.ts";
import { day } from "./clock.ts";
import { focusOf } from "./trees.ts";
import { SpendMark, SPEND, type Spend, useSpend } from "./spend.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** The fill, made once per load: `RunSlot` shows other plugins' marks on the run's line. */
export function runFill({ hk, here, set, invoke, RunSlot }: { hk: ReturnType<typeof hooks>; here: HereRead; set: HereSet; invoke: ActionInvoke; RunSlot: (p: { run: RunInfo }) => unknown }) {
  const RunFill = () => {
    const nodes = hk.useNodes();
    const dials = useDials(here);
    const { run, info, runs, all, live, lives } = hk.useRun();
    const profile = hk.useHere<string>(PROFILE);
    const inProfile = hk.useRunsIn(runs, all ? profile : undefined);
    const profileTitle = hk.useProfileList().find((p) => p.id === profile)?.title;
    // Live: the agent in focus (its tree is big), its events as one run's, each line opening in place.
    const focusKey = hk.useHere<string>(FOCUS);
    const focused = live ? focusOf(lives.map((r) => r.run), focusKey) : undefined;
    const shown = live ? focused : run;
    const shownInfo = live ? lives.find((r) => r.run === focused) : info;
    const events = hk.useEvents(shown);
    const event = hk.useHere<string>(KEYS.event);
    const picked = hk.useHere<string>(KEYS.node);
    const index = playhead(events, event);
    const verdictsOfRun = hk.useVerdictsOfRun(shown);
    const titles = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
    const speakers = useMemo(() => new Map(nodes.map((n) => [n.id, { title: n.title, kind: n.kind }])), [nodes]);
    const inProfiles = hk.useRunProfiles(shownInfo);
    // Spend against estimate: the runs listed, or the one shown (the budget plugin's action).
    const hasSpend = hk.useHas(SPEND);
    const spendRuns = all ? (inProfile ?? []).map((r) => r.run) : shown ? [shown] : [];
    const spend = useSpend(invoke, hasSpend, spendRuns, all ? runs.length : events.length);
    if (all) return html`<${Runs} runs=${inProfile} of=${profile ? (profileTitle ?? profile) : undefined} spend=${spend} />`;
    return html`<${Events} spend=${shown ? spend.get(shown) : undefined} info=${shownInfo} events=${events} index=${index} end=${index === events.length - 1} verdicts=${verdictsOfRun} titles=${titles} speakers=${speakers} node=${picked} profiles=${inProfiles} extra=${shownInfo && html`<${RunSlot} run=${shownInfo} />`} rowMs=${dials.row_ms} onPick=${(e: ExchangeEvent) => {
      set.set(KEYS.event, e.id);
      // The node pane follows: the event's node, or for an act the node it failed or was told just before.
      set.set(KEYS.node, nodeOf(events, events.indexOf(e), verdictsOfRun));
    }} />`;
  };

  /** Every run, or a profile's (`of`), last active first: a click looks at it alone. */
  const Runs = ({ runs, of, spend }: { runs?: RunInfo[]; of?: string; spend?: Map<string, Spend> }) => html`
    <div class="hv-pane">
      <div class="hv-head"><span class="t">Runs</span>${of && html`<span class="hv-cut" title="Only the runs this profile has in it">in ${of}</span>`}<span class="hv-dim">${runs ? runs.length : "…"}</span></div>
      <div class="hv-body">
        ${runs && !runs.length && html`<div class="hv-empty" title="Of the last 50 runs, by profile.read.of">${of ? `No run in ${of}` : "No run yet"}</div>`}
        ${(runs ?? []).map((r) => html`<div class="hv-row" title=${r.title ?? r.run} onClick=${() => set.set(KEYS.run, r.run)}>
          <span class="hv-m">${r.ended ? "○" : "●"}</span><span class="x" title=${runName(r)}>${runName(r)}</span><${SpendMark} s=${spend?.get(r.run)} /><span class="n">${day(r.started)}</span>
        </div>`)}
      </div>
    </div>`;

  return RunFill;
}
