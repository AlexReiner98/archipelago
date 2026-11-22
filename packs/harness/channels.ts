/**
 * How each node reaches the agent: its channel, shown as its dot's shape.
 * Pure, so the tests and the layout reach it without a page.
 *
 * | Channel | Shape | Reaches the agent |
 * |---|---|---|
 * | hook | circle | said at a moment by a hook: the map's words, or another plugin's context |
 * | rule | diamond | a check that can refuse a step: a rule, the schema's refusal |
 * | file | square | a file the harness loads: a skill's text, a memory file |
 * | context | triangle | there from the start: the system prompt, tool definitions, MCP instructions, listings |
 *
 * Who it is from is the colour: the map's in its pack's hue, the harness's
 * own (packs/transcript) in the `harness` token, orange.
 */
import type { NodeInfo } from "../../spec/agent.ts";

export type Channel = "hook" | "rule" | "file" | "context";
export type DotShape = "circle" | "diamond" | "square" | "triangle";

/** `key`: the few words the tree's key gives it, one line. */
export const CHANNELS: { channel: Channel; shape: DotShape; title: string; key: string; doc: string }[] = [
  { channel: "hook", shape: "circle", title: "hook", key: "said at a moment", doc: "said at a moment by a hook" },
  { channel: "rule", shape: "diamond", title: "rule", key: "can refuse a step", doc: "a check that can refuse a step" },
  { channel: "file", shape: "square", title: "file", key: "skill or memory loaded", doc: "a file the harness loads: a skill, a memory file" },
  { channel: "context", shape: "triangle", title: "context", key: "there from the start", doc: "there from the start: system prompt, tools, MCP instructions, listings" },
];

const SHAPE = new Map(CHANNELS.map((c) => [c.channel, c]));
export const shapeOf = (c: Channel): DotShape => SHAPE.get(c)!.shape;
export const channelTitle = (c: Channel): string => SHAPE.get(c)!.title;
export const channelDoc = (c: Channel): string => SHAPE.get(c)!.doc;

/** What the key can hide: a channel, the map's own nodes, or the harness's. */
export type Filter = Channel | "map" | "harness";

/** Whether a node shows with `off` hidden. */
export function shows(n: Pick<NodeInfo, "kind" | "pack" | "at" | "name">, off: ReadonlySet<string>): boolean {
  if (!off.size) return true;
  if (off.has(isHarness(n) ? "harness" : "map")) return false;
  return !off.has(channelOf(n));
}

/** The harness's own nodes (packs/transcript, given.ts). */
export const isHarness = (n: Pick<NodeInfo, "kind" | "pack"> | undefined): boolean => n?.kind === "given" && n.pack === "transcript";

/** A node's channel: by what the harness gave, else by its kind and place. */
export function channelOf(n: Pick<NodeInfo, "kind" | "pack" | "at" | "name">): Channel {
  if (isHarness(n)) {
    const name = n.name.slice(n.name.indexOf("#") + 1);
    return name.startsWith("hook:") ? "hook" : "context";
  }
  if (n.kind === "rule" || n.kind === "schema_check") return "rule";
  if (n.kind === "skill" || n.kind === "memory" || n.at.some((p) => p.startsWith("skill:") || p.startsWith("memory:"))) return "file";
  if (n.kind === "tool_text") return "context";
  return "hook";
}

/** A dot's outline at radius `r`, centred: an SVG path. Each shape is about as heavy as the circle. */
export function shapePath(shape: DotShape, r: number): string {
  const f = (x: number) => +x.toFixed(2);
  switch (shape) {
    case "circle":
      return `M${f(-r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
    case "square": {
      const s = r * 0.9;
      return `M${f(-s)} ${f(-s)}H${f(s)}V${f(s)}H${f(-s)}Z`;
    }
    case "diamond": {
      const d = r * 1.25;
      return `M0 ${f(-d)}L${f(d)} 0L0 ${f(d)}L${f(-d)} 0Z`;
    }
    case "triangle": {
      const t = r * 1.3;
      return `M0 ${f(-t)}L${f(t * 0.87)} ${f(t * 0.5)}L${f(-t * 0.87)} ${f(t * 0.5)}Z`;
    }
  }
}
