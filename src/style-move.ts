// Moved to packs/styles/kernel/style-move.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps
// its importers working until the gather step rewrites them. The pack plans the move from what it reads; the facts are
// appended here as the system's move (Archipelago.moved), which a service pack's context has no way to make: the
// write pack's, at the gather step.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/styles/kernel/style-move.ts';

export * from '../packs/styles/kernel/style-move.ts';

/** The styles pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'styles');

/** The migration: returns how many views took settings and how many styles left. */
export const moveStyles = async (l: Archipelago): Promise<{ views: number; retired: number }> => {
  const { facts, views, retired } = await moved.planStyles(await ctx(l));
  if (facts.length) await l.db.transaction((tx) => l.moved(tx, 'lens.moved', moved.STYLES_MOVED, facts));
  return { views, retired };
};
