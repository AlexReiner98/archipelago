/**
 * Every live agent with a tree of its own: the nodes its profile lets it
 * hear (`profile.read.hears`), hung as the big tree is. One agent is in
 * focus, its tree big with every name; the others are small previews in a
 * column beside it, and a click on one brings it into focus. Each is under
 * its agent's name in its colour and its profile. What an agent
 * is told colours that node and its branch in its colour, then fades
 * (tint.ts); nothing moves. Small, a tree names only what is lit, what the
 * agent was told, and what is picked.
 *
 * A switch of focus is smooth: each tree and line has a view-transition
 * name by its colour slot, so the one clicked grows into the big place and
 * the old one shrinks into the column (`switchFocus`, `switch_s`).
 *
 * In focus, a click on the agent's name looks at it alone; on its profile,
 * lists the profiles to move it into one (`profile.place`, agents.ts).
 */
import { h } from "preact";
import { useMemo } from "preact/hooks";
import htm from "htm";
import type { NodeInfo, RunInfo } from "../../spec/agent.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { sheet } from "../../spec/style.ts";
import { placementText, placementTip, type Placement } from "./agents.ts";
import { Canvas, type Fire, type Standing } from "./canvas.ts";
import { radial, treeOf, type Grouping } from "./layout.ts";
import { stateAt } from "./replay.ts";
import type { Dials } from "./tint.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** How many of the most recently active agents get a tree, besides any acting while watched. */
export const TREES_MOST = 6;

/**
 * Which live agents get a tree and which a one-line row. A tree: the one in
 * focus, the `most` last active of those that acted while watched, and the
 * `most` last active. The rest,
 * however many (a run that stopped without ending stays live), are rows.
 * `runs` is last active first; each list keeps that order.
 */
export function treesAndRows(runs: string[], acting: ReadonlySet<string>, focus: string | undefined, most: number = TREES_MOST): { trees: string[]; rows: string[] } {
  // At most twice `most` trees, however many act: the last active of those acting first.
  const tree = new Set([...(focus ? [focus] : []), ...runs.filter((r) => acting.has(r)).slice(0, most), ...runs.slice(0, most)]);
  return { trees: runs.filter((r) => tree.has(r)), rows: runs.filter((r) => !tree.has(r)) };
}

/** The agent in focus: the one picked while it is live, else the first (the last active). */
export function focusOf(runs: string[], picked: string | undefined): string | undefined {
  return picked && runs.includes(picked) ? picked : runs[0];
}

/** The nodes an agent hears; all of them while that isn't known yet. */
export function heardBy(nodes: NodeInfo[], hears: ReadonlySet<string> | undefined): NodeInfo[] {
  return hears ? nodes.filter((n) => hears.has(n.id)) : nodes;
}

/** A tree's or line's view-transition name: one per colour slot, so it carries across a switch. */
export const transitionName = (slot: number) => `hv-agent-${slot}`;

type Doc = Document & { startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> } };

/**
 * Runs `change` (which moves focus) as a view transition taking `secs`:
 * at once when it is 0, under reduced motion, or where the page has none.
 */
export function switchFocus(change: () => void, secs: number): void {
  const doc = typeof document === "undefined" ? undefined : (document as Doc);
  if (!doc?.startViewTransition || !secs || matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
  const root = doc.documentElement;
  root.classList.add("hv-switching");
  root.style.setProperty("--hv-switch", `${secs}s`);
  // The page renders the change on a microtask; the transition takes its picture after that.
  const t = doc.startViewTransition(() => new Promise<void>((done) => (change(), setTimeout(done, 0))));
  void t.finished.finally(() => root.classList.remove("hv-switching"));
}

export const TREES_STYLE = sheet(`
html.hv-switching { view-transition-name:none; }
::view-transition-group(*.hv-agent) { animation-duration:var(--hv-switch, .4s); animation-timing-function:cubic-bezier(.2,.7,.2,1); }
::view-transition-old(*.hv-agent), ::view-transition-new(*.hv-agent) { height:100%; object-fit:contain; animation-duration:var(--hv-switch, .4s); }
.hv-trees { display:grid; height:100%; min-height:0; overflow:hidden; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); }
.hv-trees.many { grid-template-columns:minmax(0,1fr) minmax(180px,22%); }
.hv-peeks { min-height:0; overflow-y:auto; border-left:1px solid var(--line); scrollbar-width:thin; }
.hv-peeks > .hv-tree { height:var(--peek, 140px); }
.hv-tree.peek { cursor:pointer; }
.hv-rows { border-top:1px solid var(--line); padding:var(--space-1) 0; }
.hv-rows .h { padding:var(--space-1) var(--space-4); color:var(--dim); font-size:var(--text-s); }
.hv-rows .r { display:flex; gap:var(--space-3); align-items:baseline; padding:1px var(--space-4); white-space:nowrap; cursor:pointer; min-width:0; }
.hv-rows .r:hover { background:color-mix(in srgb, var(--line) 35%, transparent); }
.hv-rows .r .x { overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; color:var(--dim); }
.hv-rows .r .p { color:var(--dim); flex:none; font-size:var(--text-s); max-width:45%; overflow:hidden; text-overflow:ellipsis; }
.hv-tree.peek:hover { background:color-mix(in srgb, var(--line) 35%, transparent); }
.hv-tree.peek .rx-canvas { pointer-events:none; }
.hv-tree.peek .who, .hv-tree.peek .prof { cursor:pointer; }
.hv-tree.big .hd { padding:var(--space-3) var(--space-4); }
.hv-tree { display:grid; grid-template-rows:auto minmax(0,1fr); min-height:0; min-width:0; overflow:hidden; border-right:1px solid var(--line); border-bottom:1px solid var(--line); }
.hv-tree .hd { display:flex; gap:var(--space-3); align-items:baseline; padding:var(--space-2) var(--space-4); white-space:nowrap; min-width:0; }
.hv-tree .d { flex:none; }
.hv-tree .who { font-weight:var(--bold); overflow:hidden; text-overflow:ellipsis; min-width:0; cursor:pointer; }
.hv-tree .who:hover { color:var(--pick); }
.hv-tree .prof { color:var(--dim); flex:none; cursor:pointer; }
.hv-tree .prof:hover { color:var(--fg); }
.hv-tree .n { color:var(--dim); margin-left:auto; flex:none; font-variant-numeric:tabular-nums; }
.hv-tree.quiet .who { color:var(--dim); }
`);

export interface AgentTree {
  run: RunInfo;
  /** Its colour slot: its view-transition name. */
  slot: number;
  /** Its colour, as CSS. */
  colour: string;
  placement?: Placement;
  /** The nodes it hears, by id; unknown while it reads. */
  hears?: ReadonlySet<string>;
  /** Nothing from it since the view opened. */
  quiet: boolean;
  fires: { current?: Fire };
}

export interface TreesProps {
  agents: AgentTree[];
  nodes: NodeInfo[];
  events: ExchangeEvent[];
  by: Grouping;
  hues: Map<string, string>;
  statuses: Map<string, string>;
  standing: Map<string, Standing>;
  picked?: string;
  dials: Dials;
  canPlace: boolean;
  onPick(node: string | undefined): void;
  onOpen(run: string): void;
  onProfile(run: string, at: MouseEvent): void;
  /** The agent in focus; the others are previews. */
  focus?: string;
  /** Live agents shown as one line each, not as trees. */
  rows?: AgentTree[];
  onFocus(run: string): void;
}

const One = ({ a, p, big }: { a: AgentTree; p: TreesProps; big: boolean }) => {
  const nodes = useMemo(() => heardBy(p.nodes, a.hears), [p.nodes, a.hears]);
  const tree = useMemo(() => treeOf(nodes, { by: p.by }), [nodes, p.by]);
  const placed = useMemo(() => radial(tree), [tree]);
  const mine = useMemo(() => p.events.filter((e) => e.run === a.run.run), [p.events, a.run.run]);
  const state = useMemo(() => stateAt(mine, mine.length - 1), [mine]);
  const title = a.run.title ?? a.run.run.slice(0, 8);
  return html`<div class=${`hv-tree${a.quiet ? " quiet" : ""} ${big ? "big" : "peek"}`} style=${`view-transition-name:${transitionName(a.slot)};view-transition-class:hv-agent`} title=${big ? "" : `${title}\nBring it into focus`} onClick=${big ? undefined : () => p.onFocus(a.run.run)}>
    <div class="hd">
      <span class="d" style=${`color:${a.colour}`}>●</span>
      <span class="who" title=${big ? `${title}\nLook at it alone` : `${title}\nBring it into focus`} onClick=${big ? () => p.onOpen(a.run.run) : undefined}>${title}</span>
      ${a.placement && html`<span class="prof" title=${`${placementTip(a.placement)}${big && p.canPlace ? "\nMove it to another profile" : ""}`} onClick=${big ? (e: MouseEvent) => p.canPlace && p.onProfile(a.run.run, e) : undefined}>${placementText(a.placement)}${big && p.canPlace ? " ▾" : ""}</span>`}
      <span class="n" title="The nodes it hears, of all">${a.hears ? (big ? `${nodes.length} / ${p.nodes.length}` : nodes.length) : ""}</span>
    </div>
    <${Canvas} tree=${tree} placed=${placed} hues=${p.hues} statuses=${p.statuses} heard=${state.heard} held=${state.held} counts=${state.counts} standing=${p.standing} picked=${p.picked} fires=${a.fires} onPick=${p.onPick} showKey=${false} dials=${p.dials} small=${!big} />
  </div>`;
};

export const Trees = (p: TreesProps) => {
  const focus = focusOf(p.agents.map((a) => a.run.run), p.focus);
  const rest = p.agents.filter((a) => a.run.run !== focus);
  const big = p.agents.find((a) => a.run.run === focus);
  // The previews stand at a fixed height and scroll, however many agents are live.
  return html`<div class="hv-trees${rest.length || p.rows?.length ? " many" : ""}">
    ${big && html`<${One} key=${big.run.run} a=${big} p=${p} big=${true} />`}
    ${(rest.length > 0 || p.rows?.length) && html`<div class="hv-peeks">
      ${rest.map((a) => html`<${One} key=${a.run.run} a=${a} p=${p} big=${false} />`)}
      ${p.rows?.length ? html`<div class="hv-rows">
        <div class="h" title="Live, but not among the last active: a run that stopped without ending stays live">${p.rows.length} more live</div>
        ${p.rows.map((a) => html`<div class="r" key=${a.run.run} style=${`view-transition-name:${transitionName(a.slot)};view-transition-class:hv-agent`} title=${`${a.run.title ?? a.run.run}\nBring it into focus`} onClick=${() => p.onFocus(a.run.run)}>
          <span style=${`color:${a.colour}`}>●</span><span class="x">${a.run.title ?? a.run.run.slice(0, 8)}</span>${a.placement && html`<span class="p">${placementText(a.placement)}</span>`}
        </div>`)}
      </div>` : ""}
    </div>`}
  </div>`;
};
