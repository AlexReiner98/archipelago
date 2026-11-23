/**
 * What the tree draws, as data: each branch and each mark (a node or a
 * bough's dot, its marks and its name), in the order they are painted
 * (paint.ts). Pure: the same props make the same scene, and the tests read
 * it without a page.
 *
 * The looks are the ones the SVG and its style sheet gave, rule for rule:
 * which colour a dot or a name takes when several marks meet is decided
 * here (`dotInk`, `nameInk`), as the sheet's cascade decided it.
 */
import type { NodeInfo } from "../../spec/agent.ts";
import { v } from "../../spec/style.ts";
import { channelDoc, channelOf, shapeOf, type Channel, type DotShape } from "./channels.ts";
import { isGiven } from "./given.ts";
import type { Verdict } from "./hooks.ts";
import { branchAt, STYLE, type Label, type Placed, type Tree } from "./layout.ts";
import type { Heard, Hold } from "./replay.ts";
import { useLine } from "./use.ts";
import { WINDOW_TIP, type WindowMark } from "./windowbar.ts";

/** A node's standing as a mark after its name. */
export type Standing = "up" | "down" | "gone";
export const STANDING: Record<Standing, string> = { up: "↑", down: "↓", gone: "⊝" };

/** Colours as CSS: the style's tokens with their plain fallbacks. */
export const INK = {
  fg: v("fg"),
  dim: v("dim"),
  bg: v("bg"),
  pick: v("pick"),
  quiet: v("quiet"),
  harness: v("harness"),
  say: STYLE.colors.say,
  fail: STYLE.colors.fail,
  write: STYLE.colors.write,
};
export const TONE: Record<"say" | "fail" | "write", string> = { say: INK.say, fail: INK.fail, write: INK.write };

export interface Wire {
  id: string;
  /** The branch as an SVG path, in the picture's units. */
  d: string;
  width: number;
  ink: number;
  /** On the picked node's way from the root. */
  way: boolean;
  /** What the harness gave alone. */
  given: boolean;
}

export interface Mark {
  /** The tree node's id. */
  id: string;
  /** The node a press on it picks: a node's id, or a decided leaf's node; none on a bough. */
  node?: string;
  x: number;
  y: number;
  depth: number;
  /** A bough's dot, not a node. */
  bough: boolean;
  /** The dot's radius, in the picture's units, before a channel's shape grows it. */
  r: number;
  /** A node's channel: its dot is that shape. None: a plain circle. */
  channel?: Channel;
  shape?: DotShape;
  /** Its pack's hue, as CSS. */
  hue?: string;
  trial: boolean;
  /** What the harness gave alone (a given node, or a bough of only those). */
  theirs: boolean;
  /** A given node itself: its shape is never filled in its pack's hue. */
  given: boolean;
  unused: boolean;
  hear?: Heard;
  hold?: Hold;
  retired: boolean;
  picked: boolean;
  ring?: Verdict;
  window?: WindowMark;
  said?: number;
  standing?: Standing;
  label: Label;
  tip: string;
}

export interface Scene {
  wires: Wire[];
  marks: Mark[];
}

export interface SceneProps {
  tree: Tree;
  placed: Placed;
  hues: Map<string, string>;
  statuses: Map<string, string>;
  rings?: Map<string, Verdict>;
  heard: Map<string, Heard>;
  held: Map<string, Hold>;
  counts: Map<string, number>;
  standing: Map<string, Standing>;
  picked?: string;
  window?: ReadonlyMap<string, WindowMark>;
  /** What the harness gave alone, by tree id (given.ts `givenOnly`). */
  theirs: Set<string>;
}

/** The ids on the picked node's way from the root. */
export function wayOf(tree: Tree, picked?: string): Set<string> {
  const s = new Set<string>();
  for (let t = picked ? tree.byId.get(picked) : undefined; t?.parent; t = t.parent) s.add(t.id);
  return s;
}

/** Everything the tree draws, branches first, then each node in the tree's order. */
export function sceneOf(p: SceneProps): Scene {
  const way = wayOf(p.tree, p.picked);
  const rest = p.tree.order.filter((t) => t.parent);
  const wires: Wire[] = rest.map((t) => {
    const b = branchAt(t.depth);
    return { id: t.id, d: p.placed.branch.get(t.id) ?? "", width: b.width, ink: b.ink, way: way.has(t.id), given: p.theirs.has(t.id) };
  });
  const marks: Mark[] = rest.map((t) => {
    const n: NodeInfo | undefined = t.node;
    const id = n?.id ?? t.decided?.node;
    const given = isGiven(n) ? n : undefined;
    const channel = n ? channelOf(n) : undefined;
    const said = id ? p.counts.get(id) : undefined;
    const r = id ? STYLE.leaf + Math.min(3, Math.log2(1 + (said ?? 0)) * 0.45) : STYLE.node;
    // A given tool a lean profile would leave out: a shadow's hold, or held once written (use.ts).
    const hold = given?.out ? (given.out.applied ? "held" : "shadow") : n ? p.held.get(n.id) : undefined;
    const trial = !!n?.source && p.statuses.get(n.source) === "trial";
    const theirs = p.theirs.has(t.id);
    const hear = n ? p.heard.get(n.id) : undefined;
    const ring = id ? p.rings?.get(id) : undefined;
    const win = id ? p.window?.get(id) : undefined;
    const tip0 = given
      ? `${n!.title}\ngiven by ${given.by}, not the map · read only\n${channel}: ${channelDoc(channel!)}\n${n!.at.join(", ")}${given.count > 1 ? `\ngiven ${given.count} times` : ""}${given.use ? `\n${useLine(given.use)}` : ""}${given.out ? `\n${given.out.applied ? "left out by" : "would be left out by"} ${given.out.title}` : ""}`
      : !n && theirs
      ? `${t.title}\nonly what the harness gave`
      : n
      ? `${n.title}\n${n.kind} · ${n.pack} · ${channel}: ${channelDoc(channel!)}${trial ? " · trial" : ""}${hear ? ` · ${hear}` : ""}${hold ? ` · ${hold === "held" ? "held back" : "a shadow would hold it back"}` : ""}${ring ? ` · ${ring}` : ""}\n${n.at.join(", ") || "said nowhere"}${said ? `\nsaid ${said} times` : ""}`
      : t.decided ? `${t.title}\n${t.decided.up ? "kept" : "retired"}` : t.title;
    const xy = p.placed.xy.get(t.id)!;
    return {
      id: t.id,
      ...(id ? { node: id } : {}),
      x: xy.x,
      y: xy.y,
      depth: t.depth,
      bough: !id,
      r,
      ...(channel ? { channel, shape: shapeOf(channel) } : {}),
      ...(n && p.hues.get(n.pack) ? { hue: p.hues.get(n.pack)! } : {}),
      trial,
      theirs,
      given: !!given,
      unused: given?.use?.used === 0,
      ...(hear ? { hear } : {}),
      ...(hold ? { hold } : {}),
      retired: !!t.decided && !t.decided.up,
      picked: !!p.picked && p.picked === id,
      ...(ring ? { ring } : {}),
      ...(win ? { window: win } : {}),
      ...(said ? { said } : {}),
      ...(id && p.standing.get(id) ? { standing: p.standing.get(id)! } : {}),
      label: p.placed.labels.get(t.id)!,
      tip: win ? `${tip0}\n${WINDOW_TIP[win]}` : tip0,
    };
  });
  return { wires, marks };
}

/** What a light leaves on a node for a while: lit in its tone, or in a run's colour. */
export interface Lit {
  tone: "say" | "fail" | "write";
  color?: string;
}

/** A branch's stroke. */
export function wireInk(w: Wire, small: boolean): { color: string; width: number; alpha: number } {
  // The style sheet's order: a branch of what the harness gave keeps its colour on the way too; the way's ink is full.
  const color = w.given ? INK.harness : w.way ? INK.pick : INK.say;
  return { color, width: small ? 2 : w.way ? w.width + 1 : w.width, alpha: w.way ? 1 : w.ink };
}

export interface DotInk {
  fill?: string;
  fillAlpha: number;
  stroke?: string;
  strokeWidth: number;
  dash?: number[];
}

/** A dot's fill and outline, as the sheet's rules met on it. `waiting`: a light is on its way to it. */
export function dotInk(m: Mark, waiting: boolean): DotInk {
  const said = m.hear === "said";
  // Its pack's hue is set on the dot itself, over every rule but a trial's hollow; a given shape never takes it.
  const own = m.hue && !(m.shape && m.given) ? m.hue : undefined;
  const fill = m.trial ? undefined : own ?? (m.theirs ? INK.harness : INK.fg);
  let fillAlpha = 0.85;
  if (m.bough) fillAlpha = 0.5;
  if (m.theirs) fillAlpha = 0.9;
  if (said) fillAlpha = 1;
  let three: number | undefined;
  if (m.theirs && m.unused) three = 0.15;
  if (waiting && said) three = 0.85;
  if (three !== undefined) fillAlpha = three;
  let stroke: string | undefined;
  let strokeWidth = 1;
  let dash: number[] | undefined;
  if (m.trial) strokeWidth = 1.2;
  if (m.hold === "shadow") (stroke = INK.dim), (strokeWidth = 1.2), (dash = [1.5, 1]);
  if (m.picked) (stroke = INK.pick), (strokeWidth = 2);
  if (m.theirs && m.unused) (stroke = INK.harness), (strokeWidth = 1.2);
  if (m.trial && m.hue) stroke = m.hue;
  return { ...(fill ? { fill } : {}), fillAlpha, ...(stroke ? { stroke } : {}), strokeWidth, ...(dash ? { dash } : {}) };
}

export interface NameInk {
  color: string;
  /** The font's weight: the style's bold token, or a number. */
  weight: string;
  alpha: number;
  italic: boolean;
  struck: boolean;
}

/** A name's colour, weight and strength, as the sheet's rules met on it. */
export function nameInk(m: Mark, s: { waiting: boolean; lit?: Lit; small: boolean }): NameInk {
  const said = m.hear === "said", refused = m.hear === "refused";
  let color = INK.fg;
  let weight = "bold";
  if (m.theirs) (color = INK.harness), (weight = "400");
  if (m.bough) (color = INK.fg), (weight = "500");
  if (said) color = INK.say;
  if (refused) color = INK.fail;
  if (m.retired) color = INK.dim;
  if (m.picked) color = INK.pick;
  if (s.lit) color = INK.say;
  // The rules on two marks at once outweigh those on one.
  if (m.bough && m.theirs) color = INK.harness;
  if (s.waiting && (said || refused)) color = INK.fg;
  if (s.lit?.color) color = s.lit.color;
  if (s.lit?.tone === "fail") color = INK.fail;
  let alpha = 1;
  // Small, a name shows only on what is lit, said, refused or picked; a bough of what the harness gave keeps its own.
  if (s.small && !(s.lit || said || refused || m.picked)) alpha = 0;
  if (m.bough && m.theirs) alpha = 0.8;
  return { color, weight, alpha, italic: m.trial, struck: m.hold === "held" || m.retired };
}

/** The pieces of a name, in the order they read: its standing and count before it on the left half, after it on the right. */
export function nameRuns(m: Mark): { text: string; kind: "name" | "count" | Standing }[] {
  const out: { text: string; kind: "name" | "count" | Standing }[] = [];
  const st = m.standing;
  if (m.label.anchor === "end") {
    if (st) out.push({ text: `${STANDING[st]} `, kind: st });
    if (m.said) out.push({ text: `${m.said} `, kind: "count" });
    out.push({ text: m.label.text, kind: "name" });
  } else {
    out.push({ text: m.label.text, kind: "name" });
    if (m.said) out.push({ text: ` ${m.said}`, kind: "count" });
    if (st) out.push({ text: ` ${STANDING[st]}`, kind: st });
  }
  return out;
}

/** A piece's own colour, over the name's: a count is dim, a standing in its tone. */
export function runInk(kind: "name" | "count" | Standing, name: string): string {
  return kind === "count" ? INK.dim : kind === "up" ? INK.say : kind === "down" || kind === "gone" ? INK.fail : name;
}
