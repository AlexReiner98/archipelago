// Moved to packs/lenses/kernel/view-life.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps
// its importers working until the gather step rewrites them. The migrations are handed the lenses pack's context of
// the map, made when they are called (kernelContext), and append through it (ctx.move).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/lenses/kernel/view-life.ts';

export * from '../packs/lenses/kernel/view-life.ts';

/** The lenses pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'lenses');

export const moveLives = async (l: Archipelago) => moved.moveLives(await ctx(l));
export const movePins = async (l: Archipelago) => moved.movePins(await ctx(l));
