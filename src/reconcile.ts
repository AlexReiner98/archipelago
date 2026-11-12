// Moved to packs/sessions/kernel/reconcile.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the sessions pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago, Entity } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/reconcile.ts';

export * from '../packs/sessions/kernel/reconcile.ts';

/** The sessions pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'sessions');
export const unreconciled = async (l: Archipelago, run: Pick<Entity, 'id' | 'created_at'>) => moved.unreconciled(await ctx(l), run);
