// Moved to packs/runs/kernel/places.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the runs pack's context of it,
// made when it is called (kernelContext); what reads the registry alone takes the map as it is.

import type { Archipelago, Entity } from './pelago.ts';
import * as moved from '../packs/runs/kernel/places.ts';

export * from '../packs/runs/kernel/places.ts';

/** The runs pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'runs');

export const placeFor = async (l: Archipelago, keys: { remote?: string; cwd?: string }) => (await moved.placeFor(await ctx(l), keys)) as Entity | undefined;
export const scopeOf = async (l: Archipelago, id: string, open = false, among?: string[]) => moved.scopeOf(await ctx(l), id, open, among);
