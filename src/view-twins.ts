// Moved to packs/lenses/kernel/view-twins.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them (the write path's filling, src/write-fillings.ts, among them).
// What took the map is handed the pack's context of it, made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/lenses/kernel/view-twins.ts';

export * from '../packs/lenses/kernel/view-twins.ts';

/** The lenses pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'lenses');

export const twinsOf = async (l: Archipelago, ops: Parameters<typeof moved.twinsOf>[1]) => moved.twinsOf(await ctx(l), ops);
export const noTwins = async (l: Archipelago, ops: Parameters<typeof moved.noTwins>[1]) => moved.noTwins(await ctx(l), ops);
