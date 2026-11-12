// Moved to packs/sessions/kernel/chat-run.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the sessions pack's context of
// it, made when it is called (kernelContext).

import type { Archipelago, Actor, Entity } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/chat-run.ts';

export * from '../packs/sessions/kernel/chat-run.ts';

/** The sessions pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'sessions');
export const sessionsAwake = async (l: Archipelago) => moved.sessionsAwake(await ctx(l));
export const resolveRun = async (l: Archipelago, key: string, openOnly = false) => (await moved.resolveRun(await ctx(l), key, openOnly)) as Entity | undefined;
export const takeUp = async (l: Archipelago, actor: Actor, run: Entity) => moved.takeUp(await ctx(l), actor, run);
export const sessionPrompted = async (l: Archipelago, sessionId: string | undefined, actor: Actor) => moved.sessionPrompted(await ctx(l), sessionId, actor);
export const hookRunHere = async (l: Archipelago, input: { cwd?: string; branch?: string }) => (await moved.hookRunHere(await ctx(l), input)) as Entity | undefined;
