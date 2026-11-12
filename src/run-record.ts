// Moved to packs/sessions/kernel/run-record.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the sessions pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago, Actor } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/run-record.ts';

export * from '../packs/sessions/kernel/run-record.ts';

/** The sessions pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'sessions');
export const recordRun = async (l: Archipelago, actor: Actor, input: Parameters<typeof moved.recordRun>[2]) => moved.recordRun(await ctx(l), actor, input);
