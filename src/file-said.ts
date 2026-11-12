// Moved to packs/sessions/kernel/file-said.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the sessions pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/file-said.ts';

export * from '../packs/sessions/kernel/file-said.ts';

/** The sessions pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'sessions');
export const fileSaid = async (l: Archipelago, input: Parameters<typeof moved.fileSaid>[1]) => moved.fileSaid(await ctx(l), input);
