/**
 * Each agent's colour on the Shared plan, as the Context interface gives
 * live runs theirs: the style's hues (`hue-1`…), as tokens. A run keeps its
 * colour while it is shown; a new one takes the first colour free.
 *
 * - `colours`: each run's colour slot, kept from before where it can be.
 * - `colourOf`: a slot's colour, from the style's hues and past them.
 */
import { HUES, v, type Token } from "../../spec/style.ts";

/** Each run's colour slot: the one it had, else the lowest not taken. As many as there are runs. */
export function colours(runs: string[], had: Map<string, number> = new Map()): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of runs) {
    const was = had.get(r);
    if (was !== undefined) out.set(r, was);
  }
  for (const r of runs) {
    if (out.has(r)) continue;
    const taken = new Set(out.values());
    let i = 0;
    while (taken.has(i)) i++;
    out.set(r, i);
  }
  return out;
}

/**
 * The hues an agent takes: the style's, less the warm `hue-2` and `hue-4`, too near the orange
 * that marks what Claude Code gave, so an agent never reads as Claude Code.
 */
export const AGENT_HUES: readonly Token[] = HUES.filter((t) => t !== "hue-2" && t !== "hue-4");

/**
 * A slot's colour, from the style's tokens only: the agent hues, then round
 * again mixed toward the text colour (lighter by night), then toward the
 * page (darker), and so on.
 */
export function colourOf(slot: number, tokens: readonly Token[] = AGENT_HUES): string {
  const hue = v(tokens[slot % tokens.length]!);
  const round = Math.floor(slot / tokens.length);
  if (!round) return hue;
  const toward = round % 2 ? v("fg") : v("bg");
  const share = Math.max(30, 65 - 10 * Math.floor((round - 1) / 2));
  return `color-mix(in srgb, ${hue} ${share}%, ${toward})`;
}
