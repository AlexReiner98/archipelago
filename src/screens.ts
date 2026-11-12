// Moved to packs/styles/kernel/screens.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it, made
// when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/styles/kernel/screens.ts';

export * from '../packs/styles/kernel/screens.ts';

/** The styles pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'styles');

export const withScreens = async <T extends { screens: (moved.ScreenDef & { pack: string })[] }>(l: Archipelago, described: T) => moved.withScreens(await ctx(l), described);
