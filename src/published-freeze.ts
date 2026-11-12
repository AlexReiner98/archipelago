// Moved to packs/publish/kernel/published-freeze.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the publish pack's context of it,
// made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/publish/kernel/published-freeze.ts';

export * from '../packs/publish/kernel/published-freeze.ts';

/** The publish pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'publish');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export const freezeDocument = async (l: Archipelago, ...rest: Rest<typeof moved.freezeDocument>) => moved.freezeDocument(await ctx(l), ...rest);
export const wouldPublish = async (l: Archipelago, ...rest: Rest<typeof moved.wouldPublish>) => moved.wouldPublish(await ctx(l), ...rest);
export const publishedState = async (l: Archipelago, ...rest: Rest<typeof moved.publishedState>) => moved.publishedState(await ctx(l), ...rest);
export const publishPlan = async (l: Archipelago, ...rest: Rest<typeof moved.publishPlan>) => moved.publishPlan(await ctx(l), ...rest);
