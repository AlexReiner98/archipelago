// Moved to packs/placement/kernel/island-start.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim
// keeps its importers working until the gather step rewrites them. What took the map is handed the placement pack's
// context of it, made when it is called (kernelContext), and the change it makes: as the actor who turned islands on,
// and for a new map's first island as the server (apply), as before.

import type { Actor, Archipelago } from './pelago.ts';
import * as moved from '../packs/placement/kernel/island-start.ts';

export * from '../packs/placement/kernel/island-start.ts';

/** The placement pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'placement');

export const islandBlockers = async (l: Archipelago) => moved.islandBlockers(await ctx(l));
export const moveOntoIslands = async (l: Archipelago, actor: Actor) => moved.moveOntoIslands(await ctx(l), (input) => l.change(actor, input));
export const firstIsland = (l: Archipelago, name: string) => moved.firstIsland((input) => l.apply('system', input), name);
