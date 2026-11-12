// Moved to packs/styles/kernel/style-move.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps
// its importers working until the gather step rewrites them. The pack plans the move from what it reads and appends it
// as the system's move through its context (ctx.move).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/styles/kernel/style-move.ts';

export * from '../packs/styles/kernel/style-move.ts';

/** The styles pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'styles');

/** The migration: returns how many views took settings and how many styles left. */
export const moveStyles = async (l: Archipelago): Promise<{ views: number; retired: number }> => moved.moveStyles(await ctx(l));
