// Moved to packs/sessions/kernel/hook-tool.ts (docs/kernel-packs.md, "Moving a service in the wave"): the tool is the
// sessions pack's filling of the surface's slot surface.tools, run on its own context of the map it is called on.
export * from '../packs/sessions/kernel/hook-tool.ts';
import type { Archipelago } from './pelago.ts';

/** The sessions pack's context of a map, whether or not the map has it on: a session's hooks answer on any map. */
export const context = async (l: Archipelago) => (await import('./kernel-context.ts')).ownContext(l, 'sessions');
