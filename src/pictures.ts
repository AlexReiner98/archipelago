// Moved to packs/publish/kernel/pictures.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the publish pack's context of it,
// made when it is called (kernelContext).

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/publish/kernel/pictures.ts';

export * from '../packs/publish/kernel/pictures.ts';

/** The publish pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'publish');

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export const putPicture = async (l: Archipelago, ...rest: Rest<typeof moved.putPicture>) => moved.putPicture(await ctx(l), ...rest);
export const getPicture = async (l: Archipelago, ...rest: Rest<typeof moved.getPicture>) => moved.getPicture(await ctx(l), ...rest);
