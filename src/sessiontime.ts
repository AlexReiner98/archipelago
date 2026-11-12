// Moved to packs/runs/kernel/sessiontime.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the runs pack's context of it,
// made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/runs/kernel/sessiontime.ts';

export * from '../packs/runs/kernel/sessiontime.ts';

/** The runs pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'runs');

export const runSpans = async (l: Archipelago, runs: moved.Run[], from: number, to: number, now?: number) => moved.runSpans(await ctx(l), runs, from, to, now);
