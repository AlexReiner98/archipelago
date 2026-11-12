// Moved to packs/styles/kernel/layout-move.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps
// its importers working until the gather step rewrites them. The pack plans the move from what it reads and appends it
// as the system's move through its context (ctx.move).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/styles/kernel/layout-move.ts';

export * from '../packs/styles/kernel/layout-move.ts';

/** The styles pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'styles');

/** The migration: returns the styles that became layouts. */
export const moveLayouts = async (l: Archipelago): Promise<string[]> => moved.moveLayouts(await ctx(l));
