// Moved to packs/query/kernel/views.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the query pack's context of it,
// made when it is called (kernelContext), so this module imports nothing the reads import.

import type { Actor, Archipelago } from './pelago.ts';
import * as moved from '../packs/query/kernel/views.ts';

export * from '../packs/query/kernel/views.ts';

/** The query pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'query');

/** A view as the map asks it. */
export interface View {
  description: string;
  run(l: Archipelago, input: Record<string, unknown>, actor?: Actor): Promise<unknown>;
}

export const VIEWS: Record<string, View> = Object.fromEntries(
  Object.entries(moved.VIEWS).map(([name, v]) => [name, { description: v.description, run: async (l: Archipelago, input: Record<string, unknown>, actor?: Actor) => v.run(await ctx(l), input, actor as moved.Actor | undefined) }]),
);

export const askPackView = async (l: Archipelago, name: string, params: Record<string, unknown>) => moved.askPackView(await ctx(l), name, params);
