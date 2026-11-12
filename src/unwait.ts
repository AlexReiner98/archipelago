// Moved to packs/waits/kernel/unwait.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it, made
// when it is called (kernelContext); what takes a query (the apply loop's transaction) is the moved module's own.

import type { Archipelago } from './pelago.ts';
import type { Authority } from './pelago-types.ts';
import * as moved from '../packs/waits/kernel/unwait.ts';

export * from '../packs/waits/kernel/unwait.ts';

/** The waits pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'waits');

export const whoseWord = async (l: Archipelago, authority: Authority | null | undefined) => moved.whoseWord(await ctx(l), authority);
