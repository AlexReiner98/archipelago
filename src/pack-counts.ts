// Moved to packs/publish/kernel/pack-counts.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it, made
// when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/publish/kernel/pack-counts.ts';

export * from '../packs/publish/kernel/pack-counts.ts';

/** The publish pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'publish');

export const countsSince = async (l: Archipelago, stream: string, after = 0) => moved.countsSince(await ctx(l), stream, after);
