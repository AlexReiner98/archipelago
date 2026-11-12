// Moved to packs/connect/kernel/check-connections.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim
// keeps its importers working until the gather step rewrites them. The check, which took the map and an actor, is
// handed the pack's context of it, made when it is called (kernelContext), and the actor's id.

import type { Actor, Archipelago } from './pelago.ts';
import * as moved from '../packs/connect/kernel/check-connections.ts';

export * from '../packs/connect/kernel/check-connections.ts';

export const checkConnections = async (l: Archipelago, actor: Actor) => moved.checkConnections((await import('./kernel-context.ts')).kernelContext(l, 'connect'), `${actor.kind}:${actor.name}`);
