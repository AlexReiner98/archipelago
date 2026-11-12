// The placement pack's placeOnIslands (packs/placement/kernel/island-place.ts), split off src/island-items.ts
// (docs/kernel-packs.md, "Where each module goes": `placeOnIslands` to placement). This shim keeps the write path's
// filling working until the gather step rewrites it: what took the map is handed the pack's context of it.

import type { Archipelago } from './pelago.ts';
import type { Op } from './pelago-types.ts';
import type { Registry } from './packs.ts';
import * as moved from '../packs/placement/kernel/island-place.ts';

export * from '../packs/placement/kernel/island-place.ts';

/** The placement pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'placement');

export const placeOnIslands = async (l: Archipelago, reg: Registry, ops: Op[], given?: string) => moved.placeOnIslands(await ctx(l), reg, ops, given);
