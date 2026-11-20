/**
 * Marks for states, from bases and status sides, never a type's name. A
 * base's shape is its place among the bases defined; its fill is where its
 * status sits: the first open hollow, a later open half, the first closed
 * full, a later closed struck through. Shared by the canvas and the item
 * page, through the `map.marks` export.
 */
import type { Json } from "../../spec/common.ts";
import type { TypeInfo } from "../../spec/types.ts";

const SHAPES = [
  ["□", "◧", "■", "⊠"],
  ["◇", "◈", "◆", "⟡"],
  ["○", "◐", "●", "⊘"],
  ["△", "◭", "▲", "⊿"],
];

export type Side = "fresh" | "moving" | "done" | "gone";

export function side(t: TypeInfo | undefined, status: Json | undefined): Side {
  if (!t || typeof status !== "string") return "fresh";
  const o = t.statuses.open.indexOf(status);
  if (o === 0) return "fresh";
  if (o > 0) return "moving";
  return t.statuses.closed.indexOf(status) <= 0 ? "done" : "gone";
}

export function mark(bases: string[], t: TypeInfo | undefined, status: Json | undefined): string {
  const shapes = SHAPES[Math.max(0, bases.indexOf(t?.base ?? "")) % SHAPES.length]!;
  return shapes[["fresh", "moving", "done", "gone"].indexOf(side(t, status))]!;
}
