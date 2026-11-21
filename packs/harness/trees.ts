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

/** The agent in focus: the one picked while it is live, else the first (the last active). */
export function focusOf(runs: string[], picked: string | undefined): string | undefined {
  return picked && runs.includes(picked) ? picked : runs[0];
}

/** The nodes an agent hears; all of them while that isn't known yet. */
export function heardBy(nodes: NodeInfo[], hears: ReadonlySet<string> | undefined): NodeInfo[] {
  return hears ? nodes.filter((n) => hears.has(n.id)) : nodes;
}

export const TREES_STYLE = sheet(`
.hv-trees { display:grid; height:100%; min-height:0; overflow:hidden; grid-template-columns:minmax(0,1fr); }
.hv-trees.many { grid-template-columns:minmax(0,1fr) minmax(180px,22%); }
.hv-tree.big { grid-column:1; grid-row:1 / -1; }
.hv-tree.peek { grid-column:2; cursor:pointer; border-left:1px solid var(--line); }
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
  onFocus(run: string): void;
}

const One = ({ a, p, big, row }: { a: AgentTree; p: TreesProps; big: boolean; row: number }) => {
  const nodes = useMemo(() => heardBy(p.nodes, a.hears), [p.nodes, a.hears]);
  const tree = useMemo(() => treeOf(nodes, { by: p.by }), [nodes, p.by]);
  const placed = useMemo(() => radial(tree), [tree]);
  const mine = useMemo(() => p.events.filter((e) => e.run === a.run.run), [p.events, a.run.run]);
  const state = useMemo(() => stateAt(mine, mine.length - 1), [mine]);
  const title = a.run.title ?? a.run.run.slice(0, 8);
  return html`<div class=${`hv-tree${a.quiet ? " quiet" : ""} ${big ? "big" : "peek"}`} style=${big ? "" : `grid-row:${row}`} title=${big ? "" : `${title}\nBring it into focus`} onClick=${big ? undefined : () => p.onFocus(a.run.run)}>
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
  // Every tree keeps its component when focus moves (keyed by run), so its colours carry over; only its place changes.
  return html`<div class="hv-trees${rest.length ? " many" : ""}" style=${rest.length ? `grid-template-rows:repeat(${rest.length}, minmax(0,1fr))` : "grid-template-rows:minmax(0,1fr)"}>
    ${p.agents.map((a) => html`<${One} key=${a.run.run} a=${a} p=${p} big=${a.run.run === focus} row=${rest.indexOf(a) + 1} />`)}
  </div>`;
};
