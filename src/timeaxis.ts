// Moved to packs/query/kernel/timeaxis.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the query pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/query/kernel/timeaxis.ts';

export * from '../packs/query/kernel/timeaxis.ts';

/** The query pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'query');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;
export const placeAll = async (l: Archipelago, ...rest: Rest<typeof moved.placeAll>) => moved.placeAll(await ctx(l), ...rest);
export const zoneOf = async (l: Archipelago) => moved.zoneOf(await ctx(l));
