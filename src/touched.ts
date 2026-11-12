// Moved to packs/sessions/kernel/touched.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the sessions pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/touched.ts';

export * from '../packs/sessions/kernel/touched.ts';

/** The sessions pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'sessions');
export const addTouched = async (l: Archipelago, run: string, said: unknown) => moved.addTouched(await ctx(l), run, said);
export const touchedBy = async (l: Archipelago, run: string) => moved.touchedBy(await ctx(l), run);
export const touchedByAll = async (l: Archipelago, runs: string[]) => moved.touchedByAll(await ctx(l), runs);
export const keepTouched = async (l: Archipelago, run: string) => moved.keepTouched(await ctx(l), run);
