// Moved to packs/runs/kernel/session-state.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps
// its importers working until the gather step rewrites them. What took the map is handed the runs pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/runs/kernel/session-state.ts';

export * from '../packs/runs/kernel/session-state.ts';

/** The runs pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'runs');

export const sessionStates = async (l: Archipelago, runs: string[], now?: string) => moved.sessionStates(await ctx(l), runs, now);
export const sessionState = async (l: Archipelago, run: string, now?: string) => moved.sessionState(await ctx(l), run, now);
