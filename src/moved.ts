// Moved to packs/attention/kernel/moved.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/attention/kernel/moved.ts';

export * from '../packs/attention/kernel/moved.ts';

/** The attention pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'attention');

export const movedReadings = async (l: Archipelago, readers: string[]) => moved.movedReadings(await ctx(l), readers);
export const readersOf = async (l: Archipelago, me?: string, isOwner = false) => moved.readersOf(await ctx(l), me, isOwner);
export const movedIds = async (l: Archipelago) => moved.movedIds(await ctx(l));
