// Moved to packs/views/kernel/timelanes.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/views/kernel/timelanes.ts';

export * from '../packs/views/kernel/timelanes.ts';

/** The views pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'views');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;
export const fileOnAxis = async (l: Archipelago, ...args: Rest<typeof moved.fileOnAxis>) => moved.fileOnAxis(await ctx(l), ...args);
