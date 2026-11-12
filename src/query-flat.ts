// Moved to packs/query/kernel/query-flat.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the query pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/query/kernel/query-flat.ts';

export * from '../packs/query/kernel/query-flat.ts';

/** The query pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'query');

export const flatRead = async (l: Archipelago, input: Record<string, unknown>) => moved.flatRead(await ctx(l), input);
/** The lens asked for, each field checked: read against the terms the packs here provide. */
export const readFlat = async (l: Archipelago, input: Record<string, unknown>) => moved.readFlat(moved.termsOf(await ctx(l)), input);
export const flatProblem = async (l: Archipelago, input: Record<string, unknown>) => moved.flatProblem(await ctx(l), input);
