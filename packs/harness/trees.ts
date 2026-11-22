/**
 * Every live agent with a tree of its own: the nodes its profile lets it
 * hear (`profile.read.hears`), hung as the big tree is. One agent is in
 * focus, its tree big with every name; the others are small previews in a
 * column to its left, and a click on one brings it into focus. Each is under
 * its agent's name in its colour and its profile. What an agent
 * is told colours that node and its branch in its colour, then fades
 * (tint.ts); nothing moves. Small, a tree names only what is lit, what the
 * agent was told, and what is picked.
 *
 * The left bar holds the previews, or, while a node is picked, the node in
 * their place; picking none brings the previews back.
 *
 * A switch of focus is smooth: each tree's drawing, or a line's coloured
 * dot, and nothing else, has a view-transition name by its colour slot, so
 * the one clicked grows into the big place (out of its dot, from a line)
 * and the old one shrinks into the column (into its dot, if it becomes a
 * line); headers and text change in place (`switchFocus`, `switch_s`).
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
import type { KeyFilter } from "./key.ts";
import { radial, treeOf, type Grouping } from "./layout.ts";
import { stateAt } from "./replay.ts";
import { WindowBar, type WindowMark, type WindowRead } from "./windowbar.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** How many previews the column shows as trees. */
export const PREVIEWS = 3;

/**
 * Which live agents get a tree and which a one-line row. A tree: the one in
 * focus, and the `most` last active besides it, as previews. The rest,
 * however many (a run that stopped without ending stays live), are rows.
 * `runs` is last active first; each list keeps that order.
 */
export function treesAndRows(runs: string[], focus: string | undefined, most: number = PREVIEWS): { trees: string[]; rows: string[] } {
  const tree = new Set([...(focus ? [focus] : []), ...runs.filter((r) => r !== focus).slice(0, most)]);
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

/** A tree drawing's view-transition name: one per colour slot, so it carries across a switch. */
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
.hv-tree .rx-canvas { view-transition-name:var(--hv-vt, none); view-transition-class:hv-agent; }
::view-transition-group(*.hv-agent) { animation-duration:var(--hv-switch, .4s); animation-timing-function:cubic-bezier(.2,.7,.2,1); }
::view-transition-old(*.hv-agent), ::view-transition-new(*.hv-agent) { height:100%; object-fit:contain; animation-duration:var(--hv-switch, .4s); }
::view-transition-old(*.hv-agent) { animation:hv-gone .12s ease-out both; }
@keyframes hv-gone { to { opacity:0; } }
.hv-trees { display:grid; height:100%; min-height:0; overflow:hidden; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); }
.hv-trees.many { grid-template-columns:minmax(180px,22%) minmax(0,1fr); }
.hv-peeks { order:-1; min-height:0; overflow-y:auto; border-right:1px solid var(--line); scrollbar-width:thin; }
.hv-peeks > .hv-tree { height:var(--peek, 140px); }
.hv-side { display:flex; flex-direction:column; }
.hv-side > .hv-pane { flex:1; min-height:0; }
.hv-back { flex:none; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); }
.hv-back button { font:inherit; background:none; border:0; padding:0; color:var(--dim); cursor:pointer; }
.hv-back button:hover { color:var(--fg); }
.hv-tree.peek { cursor:pointer; }
.hv-rows { border-top:1px solid var(--line); padding:var(--space-1) 0; }
.hv-rows .h { padding:var(--space-1) var(--space-4); color:var(--dim); font-size:var(--text-s); }
.hv-rows .r { display:flex; gap:var(--space-3); align-items:baseline; padding:1px var(--space-4); white-space:nowrap; cursor:pointer; min-width:0; }
.hv-rows .r:hover { background:color-mix(in srgb, var(--line) 35%, transparent); }
.hv-rows .r .dot { display:inline-block; view-transition-name:var(--hv-vt, none); view-transition-class:hv-agent; }
.hv-rows .r .x { overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; color:var(--dim); }
.hv-rows .r .p { color:var(--dim); flex:none; font-size:var(--text-s); max-width:45%; overflow:hidden; text-overflow:ellipsis; }
.hv-tree.peek:hover { background:color-mix(in srgb, var(--line) 35%, transparent); }
.hv-tree.peek .rx-canvas { pointer-events:none; }
.hv-tree.peek .who, .hv-tree.peek .prof { cursor:pointer; }
.hv-tree.big .hd { padding:var(--space-3) var(--space-4); }
.hv-tree.big.win { grid-template-rows:auto auto minmax(0,1fr); }
.hv-tree.big.win .hd { padding-bottom:var(--space-1); }
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
  canPlace: boolean;
  onPick(node: string | undefined): void;
  onOpen(run: string): void;
  onProfile(run: string, at: MouseEvent): void;
  /** The agent in focus; the others are previews. */
  focus?: string;
  /** Live agents shown as one line each, not as trees. */
  rows?: AgentTree[];
  /** What the left bar shows instead of the previews: the node picked. */
  side?: unknown;
  onFocus(run: string): void;
  /** What the harness gave each agent, by run: read-only nodes hung into its tree (given.ts). */
  given?: Map<string, NodeInfo[]>;
  /** The marks' key, over the agent in focus, and what it hides. */
  showKey?: boolean;
  keyOpen?: boolean;
  onKeyOpen?(open: boolean): void;
  keyFilter?: KeyFilter;
  /** The window of the agent in focus, live, and each node's place in it (windowbar.ts). */
  win?: WindowRead;
  winMarks?: ReadonlyMap<string, WindowMark>;
}

const One = ({ a, p, big }: { a: AgentTree; p: TreesProps; big: boolean }) => {
  // Keyed by what it hears, not by the set read: hearing is read again often, mostly the same.
  const hearsKey = a.hears ? [...a.hears].sort().join(",") : "*";
  const extra = p.given?.get(a.run.run);
  const heard = useMemo(() => heardBy(p.nodes, a.hears), [p.nodes, hearsKey]);
  const nodes = useMemo(() => (extra?.length ? [...heard, ...extra] : heard), [heard, extra]);
  const tree = useMemo(() => treeOf(nodes, { by: p.by }), [nodes, p.by]);
  const placed = useMemo(() => radial(tree), [tree]);
  const mine = useMemo(() => p.events.filter((e) => e.run === a.run.run), [p.events, a.run.run]);
  const state = useMemo(() => stateAt(mine, mine.length - 1), [mine]);
  const title = a.run.title ?? a.run.run.slice(0, 8);
  return html`<div class=${`hv-tree${a.quiet ? " quiet" : ""} ${big ? "big" : "peek"}${big && p.win ? " win" : ""}`} style=${`--hv-vt:${transitionName(a.slot)}`} title=${big ? "" : `${title}\nBring it into focus`} onClick=${big ? undefined : () => p.onFocus(a.run.run)}>
    <div class="hd">
      <span class="d" style=${`color:${a.colour}`}>●</span>
      <span class="who" title=${big ? `${title}\nLook at it alone` : `${title}\nBring it into focus`} onClick=${big ? () => p.onOpen(a.run.run) : undefined}>${title}</span>
      ${a.placement && html`<span class="prof" title=${`${placementTip(a.placement)}${big && p.canPlace ? "\nMove it to another profile" : ""}`} onClick=${big ? (e: MouseEvent) => p.canPlace && p.onProfile(a.run.run, e) : undefined}>${placementText(a.placement)}${big && p.canPlace ? " ▾" : ""}</span>`}
      <span class="n" title=${`The nodes it hears, of all${extra?.length ? `; and ${extra.length} the harness gave it` : ""}`}>${a.hears ? (big ? `${heard.length} / ${p.nodes.length}` : heard.length) : ""}${extra?.length ? ` + ${extra.length}` : ""}</span>
    </div>
    ${big && p.win && html`<${WindowBar} w=${p.win} filter=${p.keyFilter} />`}
    <${Canvas} tree=${tree} placed=${placed} hues=${p.hues} statuses=${p.statuses} heard=${state.heard} held=${state.held} counts=${state.counts} standing=${p.standing} picked=${p.picked} fires=${a.fires} onPick=${p.onPick} showKey=${big && !!p.showKey} keyOpen=${p.keyOpen} onKeyOpen=${p.onKeyOpen} keyFilter=${p.keyFilter} small=${!big} window=${big ? p.winMarks : undefined} />
  </div>`;
};

export const Trees = (p: TreesProps) => {
  const focus = focusOf(p.agents.map((a) => a.run.run), p.focus);
  const rest = p.agents.filter((a) => a.run.run !== focus);
  const big = p.agents.find((a) => a.run.run === focus);
  // The previews stand at a fixed height and scroll, however many agents are live.
  // The left bar is one: the previews, or, while a node is picked, the node in their place.
  return html`<div class="hv-trees${p.side || rest.length || p.rows?.length ? " many" : ""}">
    ${big && html`<${One} key=${big.run.run} a=${big} p=${p} big=${true} />`}
    ${p.side ? html`<div class="hv-peeks hv-side">${p.side}</div>` : (rest.length > 0 || p.rows?.length) && html`<div class="hv-peeks">
      ${rest.map((a) => html`<${One} key=${a.run.run} a=${a} p=${p} big=${false} />`)}
      ${p.rows?.length ? html`<div class="hv-rows">
        <div class="h" title="Live, but not among the last active: a run that stopped without ending stays live">${p.rows.length} more live</div>
        ${p.rows.map((a) => html`<div class="r" key=${a.run.run} title=${`${a.run.title ?? a.run.run}\nBring it into focus`} onClick=${() => p.onFocus(a.run.run)}>
          <span class="dot" style=${`color:${a.colour};--hv-vt:${transitionName(a.slot)}`}>●</span><span class="x">${a.run.title ?? a.run.run.slice(0, 8)}</span>${a.placement && html`<span class="p">${placementText(a.placement)}</span>`}
        </div>`)}
      </div>` : ""}
    </div>`}
  </div>`;
};
