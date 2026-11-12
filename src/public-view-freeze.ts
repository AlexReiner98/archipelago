// Moved to packs/publish/kernel/public-view-freeze.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the publish pack's context of it,
// made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/publish/kernel/public-view-freeze.ts';

export * from '../packs/publish/kernel/public-view-freeze.ts';

/** The publish pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'publish');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export const freeze = async (l: Archipelago, ...rest: Rest<typeof moved.freeze>) => moved.freeze(await ctx(l), ...rest);
export const sharePlan = async (l: Archipelago, ...rest: Rest<typeof moved.sharePlan>) => moved.sharePlan(await ctx(l), ...rest);
export const sharedState = async (l: Archipelago, ...rest: Rest<typeof moved.sharedState>) => moved.sharedState(await ctx(l), ...rest);
export const sharedViews = async (l: Archipelago, ...rest: Rest<typeof moved.sharedViews>) => moved.sharedViews(await ctx(l), ...rest);
export const readableItem = async (l: Archipelago, ...rest: Rest<typeof moved.readableItem>) => moved.readableItem(await ctx(l), ...rest);
