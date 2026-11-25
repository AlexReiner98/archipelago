/**
 * What the pointer lit, carried from one graph to the next by id: a new graph (an item or a session coming, a
 * filter) renumbers the particles, and the light, the hover and how lit each particle is stay on the same
 * items, so nothing pointed at goes dark in one frame.
 */
import type { G } from "./graph.ts";

/** A particle's index in `next`, from its index in `last`: -1 when it is gone, or was none. */
export function carryIndex(last: Pick<G, "id"> | null, next: Pick<G, "idIx">, i: number): number {
  if (!last || i < 0) return -1;
  const id = last.id[i];
  return id === undefined ? -1 : next.idIx.get(id) ?? -1;
}

/** How lit each particle is, and which are, renumbered from `last` to `next`; the focus with them. */
export function carryLight(
  last: Pick<G, "id"> | null,
  next: Pick<G, "idIx" | "n">,
  shine: Float32Array,
  shining: ReadonlySet<number>,
  focus: number,
): { shine: Float32Array; shining: Set<number>; focus: number } {
  const out = new Float32Array(next.n), lit = new Set<number>();
  for (const i of shining) {
    const j = carryIndex(last, next, i);
    if (j >= 0) (out[j] = shine[i] ?? 0), lit.add(j);
  }
  return { shine: out, shining: lit, focus: carryIndex(last, next, focus) };
}
