/**
 * Folding a side: which fills are folded, and whether a region shows as a
 * rail. Pure, so it is tested without a page.
 *
 * The folded fills are a list of fill keys (`pack/name`), the frame's page
 * key `frame.folded`. A region is a rail when every fill it shows is
 * folded; unfolding a rail opens all of them, folding a region folds all.
 */

/** The frame's page key: the fill keys folded. */
export const FOLDED = "frame.folded";

/** True when the region shows only as a rail: it has fills and every one is folded. */
export function isRail(shown: string[], folded: readonly string[]): boolean {
  return shown.length > 0 && shown.every((k) => folded.includes(k));
}

/** The folded list with the region's fills folded (`fold`) or opened. Order kept, no repeats. */
export function foldRegion(folded: readonly string[], shown: string[], fold: boolean): string[] {
  const rest = folded.filter((k) => !shown.includes(k));
  return fold ? [...rest, ...shown] : rest;
}

/** The folded list read from a page key's value, else the config's default. */
export function foldedOf(value: unknown, fallback: readonly string[] = []): string[] {
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [...fallback];
}
