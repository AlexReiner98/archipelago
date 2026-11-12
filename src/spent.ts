// Moved to packs/runs/kernel/spent.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the runs pack's context of it,
// made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/runs/kernel/spent.ts';

export * from '../packs/runs/kernel/spent.ts';

/** The runs pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'runs');

export const spent = async (l: Archipelago, input: { days?: number }) => moved.spent(await ctx(l), input);
