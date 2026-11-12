// Moved to packs/sessions/kernel/sessions.ts (docs/kernel-packs.md, "Moving a service in the wave (as built)", "The
// shim"): this adapter keeps its importers passing the map until the gather step rewrites them, each call handed the
// sessions pack's context of that map. The kernel names the session acts and hooks on every map, so they run on the
// pack's code whether or not the map has it on, as they did before it moved (ownContext).

import type { Actor, Archipelago, Entity } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/sessions.ts';

export * from '../packs/sessions/kernel/sessions.ts';

/** The sessions pack's context of a map. */
export const sessionsContext = async (l: Archipelago) => (await import('./kernel-context.ts')).ownContext(l, 'sessions');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;
type Item = Parameters<typeof moved.labelled>[1];

export const resolveRun = async (l: Archipelago, key: string, openOnly = false) => (await moved.resolveRun(await sessionsContext(l), key, openOnly)) as Entity | undefined;
export const sessionPrompted = async (l: Archipelago, sessionId: string | undefined, actor: Actor) => moved.sessionPrompted(await sessionsContext(l), sessionId, actor as moved.Actor);
export const sessionsAwake = async (l: Archipelago) => moved.sessionsAwake(await sessionsContext(l));
export const importAudit = async (l: Archipelago, actor: Actor, input: { connection: string }) => moved.importAudit(await sessionsContext(l), actor as moved.Actor, input);
export const closeOffers = async (l: Archipelago, ...rest: Rest<typeof moved.closeOffers>) => moved.closeOffers(await sessionsContext(l), ...rest);
export const recordRun = async (l: Archipelago, actor: Actor, input: Rest<typeof moved.recordRun>[1]) => moved.recordRun(await sessionsContext(l), actor as moved.Actor, input);
export const hookWithin = async (l: Archipelago, ...rest: Rest<typeof moved.hookWithin>) => moved.hookWithin(await sessionsContext(l), ...rest);
export const sessionBegan = async (l: Archipelago, sessionId: string | undefined) => moved.sessionBegan(await sessionsContext(l), sessionId);
export const sessionStart = async (l: Archipelago, actor: Actor, input: Rest<typeof moved.sessionStart>[1]) => moved.sessionStart(await sessionsContext(l), actor as moved.Actor, input);
export const sessionHeard = async (l: Archipelago, ...rest: Rest<typeof moved.sessionHeard>) => moved.sessionHeard(await sessionsContext(l), ...rest);
export const recordUsage = async (l: Archipelago, ...rest: Rest<typeof moved.recordUsage>) => moved.recordUsage(await sessionsContext(l), ...rest);
export const sessionUpdate = async (l: Archipelago, actor: Actor, input: Rest<typeof moved.sessionUpdate>[1]) => moved.sessionUpdate(await sessionsContext(l), actor as moved.Actor, input);
export const tell = async (l: Archipelago, actor: Actor, input: Rest<typeof moved.tell>[1]) => moved.tell(await sessionsContext(l), actor as moved.Actor, input);
export const story = async (l: Archipelago, input: Record<string, unknown>) => moved.story(await sessionsContext(l), input);
export const sessionEnd = async (l: Archipelago, actor: Actor, input: Rest<typeof moved.sessionEnd>[1]) => moved.sessionEnd(await sessionsContext(l), actor as moved.Actor, input);
export const labelled = async (l: Archipelago, run: Entity, label: unknown, actor?: string) => moved.labelled(await sessionsContext(l), run as unknown as Item, label, actor);
export const promptNamed = async (l: Archipelago, run: Entity, prompt: unknown, actor?: string) => moved.promptNamed(await sessionsContext(l), run as unknown as Item, prompt, actor);
