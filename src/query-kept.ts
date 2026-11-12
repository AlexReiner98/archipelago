// Moved to packs/lenses/kernel/query-kept.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/lenses/kernel/query-kept.ts';

export * from '../packs/lenses/kernel/query-kept.ts';

/** The lenses pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'lenses');

export const everyItem = async (l: Archipelago, type: string) => moved.everyItem(await ctx(l), type);
export const keptOf = async (l: Archipelago, type: Parameters<typeof moved.keptOf>[1], named: unknown) => moved.keptOf(await ctx(l), type, named);
export const hubs = async (l: Archipelago, within?: string) => moved.hubs(await ctx(l), within);
export const pictureOf = async (l: Archipelago, id: string) => moved.pictureOf(await ctx(l), id);
