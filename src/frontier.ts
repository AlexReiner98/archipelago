// Moved to packs/runs/kernel/frontier.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the runs pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/runs/kernel/frontier.ts';

export * from '../packs/runs/kernel/frontier.ts';

/** The runs pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'runs');

export const frontier = async (l: Archipelago, input: moved.FrontierInput) => moved.frontier(await ctx(l), input);
export const workedOn = async (l: Archipelago, ids: string[]) => moved.workedOn(await ctx(l), ids);
