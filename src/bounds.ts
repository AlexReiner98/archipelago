// Moved to packs/attention/kernel/bounds.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/attention/kernel/bounds.ts';

export * from '../packs/attention/kernel/bounds.ts';

/** The attention pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'attention');

export const pastBounds = async (l: Archipelago, days: number, among: string[]) => moved.pastBounds(await ctx(l), days, among);
