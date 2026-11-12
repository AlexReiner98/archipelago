// Moved to packs/query/kernel/askview.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the query pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Actor, Archipelago } from './pelago.ts';
import * as moved from '../packs/query/kernel/askview.ts';

export * from '../packs/query/kernel/askview.ts';

/** The query pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'query');

export const askView = async (l: Archipelago, actor: Actor, name: string, params: Record<string, unknown> = {}) => moved.askView(await ctx(l), actor as Parameters<typeof moved.askView>[1], name, params);
