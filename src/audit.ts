// Moved to packs/sessions/kernel/audit.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the sessions pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago, Actor } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/audit.ts';

export * from '../packs/sessions/kernel/audit.ts';

/** The sessions pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'sessions');
export const importAudit = async (l: Archipelago, actor: Actor, input: { connection: string }) => moved.importAudit(await ctx(l), actor, input);
