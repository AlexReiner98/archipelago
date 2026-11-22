/**
 * The tree's nodes and branches as they are drawn, each its own component
 * that draws again only when what it shows changed (`memo`): a live event
 * lights or counts a few nodes, and the rest are left as they were. A
 * node's props are plain values (its tree node, place, label, and the
 * marks it carries), compared one by one.
 */
import { Component, h, type ComponentChildren } from "preact";
import htm from "htm";
import type { NodeInfo } from "../../spec/agent.ts";
import { channelDoc, channelOf, shapeOf, shapePath } from "./channels.ts";
import { isGiven } from "./given.ts";
import { shapeRadius } from "./key.ts";
import type { TreeNode } from "./layout.ts";
import type { Heard, Hold } from "./replay.ts";
import { useLine } from "./use.ts";
import { WINDOW_TIP, type WindowMark } from "./windowbar.ts";
import type { Verdict } from "./hooks.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** A node's standing as a mark after its name. */
export type Standing = "up" | "down" | "gone";
const STANDING: Record<Standing, string> = { up: "↑", down: "↓", gone: "⊝" };

/** A component that draws again only when one of its props is a different value. */
export function memo<P extends object>(draw: (p: P) => ComponentChildren): new (p: P) => Component<P> {
  return class extends Component<P> {
    shouldComponentUpdate(next: P) {
      const a = this.props as Record<string, unknown>;
      const b = next as Record<string, unknown>;
      for (const k in b) if (a[k] !== b[k]) return true;
      for (const k in a) if (!(k in b)) return true;
      return false;
    }
    render() {
      return draw(this.props as P);
    }
  };
}

export interface BranchProps {
  id: string;
  d: string | undefined;
  width: number;
  ink: number;
  way: boolean;
  theirs: boolean;
}

export const Branch = memo(({ id, d, width, ink, way, theirs }: BranchProps) =>
  html`<path data-b=${id} class=${`rx-branch${way ? " way" : ""}${theirs ? " given" : ""}`} d=${d} style=${`stroke-width:${way ? width + 1 : width};stroke-opacity:${ink}`} />`,
);

export interface NodeProps {
  t: TreeNode;
  x: number;
  y: number;
  label: { text: string; turn: number; dx: number; dy: number; anchor: string };
  /** Sizes of a leaf and of a bough's dot (layout's STYLE). */
  leaf: number;
  bough: number;
  hue?: string;
  trial: boolean;
  theirs: boolean;
  hear?: Heard;
  held?: Hold;
  standing?: Standing;
  window?: WindowMark;
  ring?: Verdict;
  said?: number;
  picked: boolean;
  /** The zoom: a channel's shape keeps its least size on screen. */
  k: number;
  small: boolean;
}

/** One node, or a bough's dot: its marks, its shape, its name. */
export const Node = memo((p: NodeProps) => {
  const { t } = p;
  const n: NodeInfo | undefined = t.node;
  const id = n?.id ?? t.decided?.node;
  const given = isGiven(n) ? n : undefined;
  const channel = n ? channelOf(n) : undefined;
  const r = id ? p.leaf + Math.min(3, Math.log2(1 + (p.said ?? 0)) * 0.45) : p.bough;
  // A given tool a lean profile would leave out: a shadow's hold, or held once written (use.ts).
  const hold = given?.out ? (given.out.applied ? "held" : "shadow") : p.held;
  const cls = [
    id ? "rx-node" : "rx-bough",
    p.trial && "rx-trial",
    p.theirs && "rx-given",
    given?.use?.used === 0 && "rx-unused",
    p.hear && `rx-${p.hear}`,
    hold && `rx-${hold}`,
    t.decided && !t.decided.up && "rx-retired",
    p.picked && "rx-pick",
  ].filter(Boolean).join(" ");
  const tip0 = given
    ? `${n!.title}\ngiven by ${given.by}, not the map · read only\n${channel}: ${channelDoc(channel!)}\n${n!.at.join(", ")}${given.count > 1 ? `\ngiven ${given.count} times` : ""}${given.use ? `\n${useLine(given.use)}` : ""}${given.out ? `\n${given.out.applied ? "left out by" : "would be left out by"} ${given.out.title}` : ""}`
    : !n && p.theirs
    ? `${t.title}\nonly what the harness gave`
    : n
    ? `${n.title}\n${n.kind} · ${n.pack} · ${channel}: ${channelDoc(channel!)}${p.trial ? " · trial" : ""}${p.hear ? ` · ${p.hear}` : ""}${hold ? ` · ${hold === "held" ? "held back" : "a shadow would hold it back"}` : ""}${p.ring ? ` · ${p.ring}` : ""}\n${n.at.join(", ") || "said nowhere"}${p.said ? `\nsaid ${p.said} times` : ""}`
    : t.decided ? `${t.title}\n${t.decided.up ? "kept" : "retired"}` : t.title;
  const tip = p.window ? `${tip0}\n${WINDOW_TIP[p.window]}` : tip0;
  const l = p.label;
  const fill = !given && p.hue ? (p.trial ? `stroke:${p.hue}` : `fill:${p.hue}`) : "";
  return html`
    <g data-id=${t.id} data-depth=${t.depth} class=${cls} transform=${`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
      <title>${tip}</title>
      ${p.window === "in" ? html`<circle class="rx-win w-in" r=${r + 5} />` : p.window === "listed" ? html`<circle class="rx-win w-listed" r=${r + 4.5} />` : ""}
      ${p.ring && html`<circle class=${`rx-ring v-${p.ring}`} r=${r + 2.5} />`}
      ${channel
        ? html`<path class="rx-dot" d=${shapePath(shapeOf(channel), shapeRadius(r, p.k, p.small))} style=${fill} />`
        : html`<circle class="rx-dot" r=${r} style=${p.hue ? (p.trial ? `stroke:${p.hue}` : `fill:${p.hue}`) : ""} />`}
      ${p.window === "dropped" && html`<path class="rx-win w-dropped" d=${`M${-(r + 3)} ${r + 3}L${r + 3} ${-(r + 3)}`} />`}
      <text class="rx-name" transform=${`rotate(${l.turn})`} x=${l.dx} y=${l.dy} text-anchor=${l.anchor}>${
        l.anchor === "end"
          ? html`${p.standing && html`<tspan class=${p.standing}>${STANDING[p.standing]} </tspan>`}${p.said ? html`<tspan class="c">${p.said} </tspan>` : ""}${l.text}`
          : html`${l.text}${p.said ? html`<tspan class="c"> ${p.said}</tspan>` : ""}${p.standing && html`<tspan class=${p.standing}> ${STANDING[p.standing]}</tspan>`}`
      }</text>
    </g>`;
});
