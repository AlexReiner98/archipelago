// Moved to packs/sessions/kernel/session-parent.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the sessions pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago, Entity } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/session-parent.ts';

export * from '../packs/sessions/kernel/session-parent.ts';

/** The sessions pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'sessions');
export const parentRun = async (l: Archipelago, parent: string) => (await moved.parentRun(await ctx(l), parent)) as Entity;
export const parentOps = async (l: Archipelago, run: string, parent: Entity, made = false) => moved.parentOps(await ctx(l), run, parent, made);
