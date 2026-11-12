// What a pack's tests may use of the kernel, by one name (#pelago/test in package.json imports): a fresh map with the
// packs, a change, a tool called as a person or an agent would. A pack's test tries the pack's own rules on a real map
// through these, never the kernel's modules, so it runs wherever the pack lives (decision e_6bucpdtc, 9 Nov 2026).
import assert from 'node:assert/strict';
import type { Actor, Archipelago, Op } from '../packs/write/kernel/pelago.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, freshWith, human, PACKS } from './map.ts';

export type { Actor, Archipelago, Op };
export { agent, human, PACKS };
/** How a style's colours are worked out, for a pack that adds colours or themes (src/colours.ts). */
export { contrast, finishTheme, mergeTheme, mix, search } from '../packs/styles/kernel/colours.ts';

/** A fresh map in memory with the kernel's packs and those in the folders given (a pack's own folder's parent). */
export const mapWith = (...folders: string[]) => freshWith(new Registry([PACKS, ...folders.filter((f) => f !== PACKS)]));

/** A change made as a person; what it created, by ref. */
export async function make(l: Archipelago, ops: Op[], as: Actor = human): Promise<Record<string, string>> {
  const result = await l.change(as, { ops, reason: 'test' });
  assert.equal(result.status, 'applied');
  return (result as { created: Record<string, string> }).created;
}

/** A tool called as an agent's client or the page calls it. */
export const call = <T = unknown>(l: Archipelago, as: Actor, tool: string, input: Record<string, unknown>) => callTool(l, as, tool, input) as Promise<T>;
