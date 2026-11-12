// Moved to packs/sessions/kernel/session-name.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the sessions pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago, Entity } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/session-name.ts';

export * from '../packs/sessions/kernel/session-name.ts';

/** The sessions pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'sessions');
export const sessionNames = (l: Archipelago) => moved.sessionNames(l);
export const mintName = async (l: Archipelago, pick = Math.random) => moved.mintName(await ctx(l), pick);
/** Kept, as the pack keeps it; the owner's page is shown it by the sessions pack's own calls (src/sessions.ts, labelled). */
export const sessionLabelled = async (l: Archipelago, run: Entity, label: unknown, actor = 'agent:claude-code') => moved.sessionLabelled(await ctx(l), run, label, actor);
export const sessionPromptNamed = async (l: Archipelago, run: Entity, prompt: unknown, actor = 'agent:claude-code') => moved.sessionPromptNamed(await ctx(l), run, prompt, actor);
