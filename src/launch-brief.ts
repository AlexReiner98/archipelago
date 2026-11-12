// Moved to packs/agents/kernel/launch-brief.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps
// its importers working until the gather step rewrites them. What took the map is handed the pack's context of it,
// made when it is called (kernelContext).

import type { Actor, Archipelago } from './pelago.ts';
import * as moved from '../packs/agents/kernel/launch-brief.ts';

export * from '../packs/agents/kernel/launch-brief.ts';

/** The agents pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'agents');

export const briefFor = async (l: Archipelago, actor: Actor, input: moved.LaunchInput, by?: moved.StartedBy) => moved.briefFor(await ctx(l), actor, input, by);
