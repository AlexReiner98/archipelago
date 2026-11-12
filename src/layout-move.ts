// Moved to packs/styles/kernel/layout-move.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps
// its importers working until the gather step rewrites them. The pack plans the move from what it reads; the facts are
// appended here as the system's move (Archipelago.moved), which a service pack's context has no way to make: the
// write pack's, at the gather step.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/styles/kernel/layout-move.ts';

export * from '../packs/styles/kernel/layout-move.ts';

/** The styles pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'styles');

/** The migration: returns the styles that became layouts. */
export const moveLayouts = async (l: Archipelago): Promise<string[]> => {
  const { facts, layouts } = await moved.planLayouts(await ctx(l));
  if (!facts.length) return [];
  await l.db.transaction((tx) => l.moved(tx, 'layout.moved', moved.LAYOUTS_MOVED, facts));
  return layouts;
};
