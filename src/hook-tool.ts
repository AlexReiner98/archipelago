// Moved to packs/claude_code/kernel/hook-tool.ts (docs/kernel-packs.md, "Moving a service in the wave"). The tool is
// declared there with its input as a JSON shape, run on the sessions pack's context (claude_code is a server pack, with
// no kernel context of its own: a pack is one or the other): the surface builds its schema
// and hands each run the context `context` makes of the map it is called on (packs/surface/kernel/tools.ts). What the
// server knows of it (configureHookTool) is the surface's root.hook (packs/surface/kernel/root-hook.ts).
export * from '../packs/claude_code/kernel/hook-tool.ts';
import type { Archipelago } from './pelago.ts';

/** The sessions pack's context of a map, whether or not the map has it on: a session's hooks answer on any map. */
export const context = async (l: Archipelago) => (await import('./kernel-context.ts')).ownContext(l, 'sessions');
