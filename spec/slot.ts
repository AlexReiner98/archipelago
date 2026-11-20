/**
 * slot: UI composition. See slot.md.
 *
 * DRAFT: the renderer (what `View` is) is an open question to Alex on the map.
 */
import type { JsonSchema } from "./action.ts";
import type { Capability, Dispose, PackId } from "./common.ts";

/**
 * A component: what a pack puts in a slot. Pinned by the renderer choice;
 * until then, a function of props whose result only the renderer reads.
 * Whatever is chosen must unmount fully (no global registration), so a
 * pack's UI goes when the pack does.
 */
export type View<P = Record<string, unknown>> = (props: P) => unknown;

/**
 * - `many`: every fill shows, in config-tree order of the filling packs
 *   (`byPosition` in common.ts), then the order each pack filled in.
 * - `one`: the first of those shows. To show another, move its pack's
 *   entry in the config tree, or disable the one in front.
 */
export type Merge = "many" | "one";

export interface SlotDef {
  /**
   * Dotted, starting with the declaring pack's id (`harness.node`); the
   * provider refuses a name outside the caller's own. `root` is reserved.
   */
  name: string;
  merge: Merge;
  /** The props every fill receives. */
  props?: JsonSchema;
  doc?: string;
}

export interface FillDef<P = Record<string, unknown>> {
  slot: string;
  /** Unique within the pack, stable across reloads. */
  name: string;
  title?: string;
  view: View<P>;
}

export interface FillInfo extends Omit<FillDef, "view"> {
  /** The pack that filled it, from its context. */
  pack: PackId;
}

/** The one slot the spec declares: the renderer mounts the fill of `root`. */
export const ROOT = "root";

/** `slot.declare`. */
export interface SlotDeclare {
  /** Declares a slot, as the calling pack's. A taken name is refused. */
  declare(def: SlotDef): Dispose;
}

/** `slot.fill`. */
export interface SlotFill {
  /** Fills a slot, as the calling pack's. A fill for a slot nobody has declared waits, shown nowhere, until one is. */
  fill<P>(def: FillDef<P>): Dispose;
}

/** `slot.read`: what the renderer reads, and a view of the UI's own structure. */
export interface SlotRead {
  /** What shows in a slot now, in order (one entry for `one`). */
  fills(slot: string): (FillDef & FillInfo)[];
  /** Every slot declared now, with the pack that declared it. */
  slots(): (SlotDef & { pack: PackId })[];
  /** Calls `on` when a slot's fills change. */
  watch(slot: string, on: () => void): Dispose;
}

export interface Capabilities {
  "slot.declare": SlotDeclare;
  "slot.fill": SlotFill;
  "slot.read": SlotRead;
}

export const capabilities: Capability[] = [
  { key: "slot.declare", since: 1, doc: "Declares a place in the UI that packs can fill." },
  { key: "slot.fill", since: 1, doc: "Puts a component in a slot." },
  { key: "slot.read", since: 1, doc: "What fills each slot now, in order, and when that changes." },
];
