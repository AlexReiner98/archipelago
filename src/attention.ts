// Moved to packs/attention/kernel/attention.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/attention/kernel/attention.ts';

export * from '../packs/attention/kernel/attention.ts';

/** The attention pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'attention');

export const attention = async (l: Archipelago, input: moved.Input, read?: moved.Read) => moved.attention(await ctx(l), input, read);
