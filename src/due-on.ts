// Moved to packs/automation_triggers/kernel/due-on.ts (docs/kernel-packs.md, "Moving a service in the wave"): this
// shim keeps its callers working until the gather step rewrites it. What took the map is handed the pack's
// context of it, made when it is called (kernelContext). Its memory stays under `due_on:` (kernel.memory).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/automation_triggers/kernel/due-on.ts';

export * from '../packs/automation_triggers/kernel/due-on.ts';

/** The automation_triggers pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'automation_triggers');

export const onPass = async (l: Archipelago, now: number) => moved.onPass(await ctx(l), now);
