// Moved to packs/publish/kernel/published-pictures.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the publish pack's context of it,
// made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/publish/kernel/published-pictures.ts';

export * from '../packs/publish/kernel/published-pictures.ts';

/** The publish pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'publish');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export const picturesOf = async (l: Archipelago, ...rest: Rest<typeof moved.picturesOf>) => moved.picturesOf(await ctx(l), ...rest);
export const keptPicture = async (l: Archipelago, ...rest: Rest<typeof moved.keptPicture>) => moved.keptPicture(await ctx(l), ...rest);
