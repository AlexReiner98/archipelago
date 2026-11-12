// Moved to packs/agents/kernel/instructions.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps
// its importers working until the gather step rewrites them. What took the map is handed the pack's context of it,
// made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/agents/kernel/instructions.ts';

export * from '../packs/agents/kernel/instructions.ts';

/** The agents pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'agents');

export const instructionsFor = async (l: Archipelago, where: string, input: Parameters<typeof moved.instructionsFor>[2] = {}) => moved.instructionsFor(await ctx(l), where, input);
