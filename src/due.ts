// Moved to packs/clocks/kernel/due.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// callers working until the gather step rewrites them. A pass over a map is handed the clocks pack's context of it,
// made when it is called (kernelContext); dueBetween reads only the types, which the map has.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/clocks/kernel/due.ts';

export * from '../packs/clocks/kernel/due.ts';

/** The clocks pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'clocks');

export const duePass = async (l: Archipelago, now?: number) => moved.duePass(await ctx(l), now);
