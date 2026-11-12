// Moved (docs/kernel-packs.md, "The shim"): what a session is told as it begins and how its end hook ends it are the
// sessions pack's (packs/sessions/kernel/session-hook.ts), the actor the hooks act as is the claude_code pack's
// (packs/claude_code/kernel/session-hook.ts). This adapter keeps its importers passing the map until the gather step
// rewrites them, each call handed the sessions pack's context of that map.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/session-hook.ts';

export * from '../packs/claude_code/kernel/session-hook.ts';
export { HOOK_AGENT, toldAt } from '../packs/sessions/kernel/session-hook.ts';

const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).ownContext(l, 'sessions');

export const hookSessionStart = async (l: Archipelago, input: Parameters<typeof moved.hookSessionStart>[1]) => moved.hookSessionStart(await ctx(l), input);
export const hookSessionEnd = async (l: Archipelago, input: Parameters<typeof moved.hookSessionEnd>[1]) => moved.hookSessionEnd(await ctx(l), input);
export const sessionIsland = async (l: Archipelago, run: string | undefined) => moved.sessionIsland(await ctx(l), run);
