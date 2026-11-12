// Moved to packs/query/kernel/query-presets.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the query pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/query/kernel/query-presets.ts';

export * from '../packs/query/kernel/query-presets.ts';

/** The query pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'query');

export const answerPreset = async (l: Archipelago, def: moved.PresetDef & Record<string, unknown>, params: Record<string, unknown>) => moved.answerPreset(await ctx(l), def, params);
