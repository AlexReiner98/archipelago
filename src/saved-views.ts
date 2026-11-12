// Moved to packs/lenses/kernel/saved-views.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps
// its importers working until the gather step rewrites them. What took the map is handed the lenses pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/lenses/kernel/saved-views.ts';

export * from '../packs/lenses/kernel/saved-views.ts';

/** The lenses pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'lenses');

export const savedViews = async (l: Archipelago, input: { limit?: number } = {}) => moved.savedViews(await ctx(l), input);
