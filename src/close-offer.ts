// Moved to packs/sessions/kernel/close-offer.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the sessions pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/close-offer.ts';

export * from '../packs/sessions/kernel/close-offer.ts';

/** The sessions pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'sessions');
type Op = { op: string; id?: string; status?: string };
export const closeOffers = async (l: Archipelago, ops: Op[]) => moved.closeOffers(await ctx(l), ops);
export const closedBy = async (l: Archipelago, ops: Op[]) => moved.closedBy(await ctx(l), ops);
export const openTargets = async (l: Archipelago, from: string[], besides?: Set<string>) => moved.openTargets(await ctx(l), from, besides);
export const offering = (l: Archipelago) => moved.offering(l);
